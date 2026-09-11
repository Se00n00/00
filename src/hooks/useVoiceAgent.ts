"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ChatMsg = {
  id: string;
  role: "user" | "agent";
  text: string;
  ts: number;
  streaming?: boolean;
};

export type VoiceStatus = "idle" | "requesting" | "live" | "error";

const WS_URL = process.env.NEXT_PUBLIC_VOICE_WS_URL ?? "";

const AGENT_REPLIES = [
  "Got you — streaming your voice to the agent in real time. Keep talking, I'm with you.",
  "Heard that loud and clear. The server is piping audio both ways with low latency.",
  "Nice — I can see your levels moving on the equalizer. What should we dive into next?",
  "Copy that. I'm the live voice agent — your mic streams up, my voice streams back.",
];

type SpeechRecognitionAlternative = { transcript: string };
type SpeechRecognitionResultLike = { isFinal: boolean; 0: SpeechRecognitionAlternative };
type SpeechRecognitionEventLike = { resultIndex: number; results: SpeechRecognitionResultLike[] };
type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const WELCOME_TS = 0;

export function useVoiceAgent() {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [micOn, setMicOn] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>(() => [
    {
      id: "welcome",
      role: "agent",
      text: "tap anywhere to talk.",
      ts: WELCOME_TS,
    },
  ]);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const replyIdx = useRef(0);
  const agentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- agent reply (local simulation; replace with real server stream) ----
  const streamAgentReply = useCallback((prompt: string) => {
    const full =
      prompt.trim().length > 0
        ? `You said: "${prompt.slice(0, 120)}" — ${AGENT_REPLIES[replyIdx.current++ % AGENT_REPLIES.length]}`
        : AGENT_REPLIES[replyIdx.current++ % AGENT_REPLIES.length];

    const id = uid();
    setAgentSpeaking(true);
    setMessages((m) => [...m, { id, role: "agent", text: "", ts: Date.now(), streaming: true }]);

    // word-by-word streaming to mimic server -> client audio/text stream
    const words = full.split(" ");
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      const slice = words.slice(0, i).join(" ");
      setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, text: slice } : msg)));
      if (i >= words.length) {
        clearInterval(timer);
        setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, streaming: false } : msg)));
        setAgentSpeaking(false);
        // speak back so the equalizer shows "agent" energy.
        // onend is unreliable (may never fire) so a timeout guarantees
        // the flag — and the gray bars — always settle afterwards.
        try {
          if (agentTimer.current) clearTimeout(agentTimer.current);
          if (!mutedRef.current && "speechSynthesis" in window) {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(full);
            u.rate = 1.05;
            const done = () => {
              setAgentSpeaking(false);
              if (agentTimer.current) clearTimeout(agentTimer.current);
            };
            u.onend = done;
            u.onerror = done;
            window.speechSynthesis.speak(u);
            setAgentSpeaking(true);
            agentTimer.current = setTimeout(done, Math.min(15000, 1500 + words.length * 350));
          }
        } catch {
          /* no tts */
        }
      }
    }, 90);
  }, []);

  const handleUserFinal = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setInterim("");
      setMessages((m) => [...m, { id: uid(), role: "user", text: t, ts: Date.now() }]);
      // If a real WS server is attached it will respond via ws.onmessage.
      // Otherwise simulate the server voice-agent locally.
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setTimeout(() => streamAgentReply(t), 450);
      }
    },
    [streamAgentReply]
  );

  const start = useCallback(async () => {
    setError(null);
    setStatus("requesting");
    // Create + resume the AudioContext SYNCHRONOUSLY in the click gesture,
    // before any await — otherwise the browser keeps it suspended and the
    // analyser only ever outputs zeros (equalizer stuck at idle).
    const win0 = window as unknown as Record<string, unknown>;
    const Ctx0 =
      (win0.AudioContext as typeof AudioContext | undefined) ??
      (win0.webkitAudioContext as typeof AudioContext | undefined);
    if (!Ctx0) {
      setStatus("error");
      setError("Web Audio not supported in this browser.");
      return;
    }
    const earlyCtx: AudioContext = new Ctx0();
    audioCtxRef.current = earlyCtx;
    if (earlyCtx.state === "suspended") {
      earlyCtx.resume().catch(() => {});
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = audioCtxRef.current ?? earlyCtx;
      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch {
          /* will retry on next tap */
        }
      }
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      src.connect(analyser);
      analyserRef.current = analyser;

      setMicOn(true);
      setStatus("live");

      // ---- stream mic chunks to voice-agent server if configured ----
      // Server contract: accept binary audio blobs (webm/opus),
      // send back JSON { type:'transcript', role:'user'|'agent', text } and/or binary audio.
      if (WS_URL) {
        try {
          const ws = new WebSocket(WS_URL);
          wsRef.current = ws;
          ws.onopen = () => setWsConnected(true);
          ws.onclose = () => setWsConnected(false);
          ws.onerror = () => setWsConnected(false);
          ws.onmessage = (ev) => {
            try {
              const data = JSON.parse(ev.data);
              if (data.type === "transcript" && data.text) {
                if (data.role === "user") handleUserFinal(String(data.text));
                else {
                  setMessages((m) => [
                    ...m,
                    { id: uid(), role: "agent", text: String(data.text), ts: Date.now() },
                  ]);
                }
              }
            } catch {
              // binary audio from server -> could decode & play here
            }
          };
          const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
          recorderRef.current = rec;
          rec.ondataavailable = (e) => {
            if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
          };
          rec.start(250); // 250ms chunks = realtime stream
        } catch {
          /* fall back to local only */
        }
      }

      // ---- live interim transcripts (browser STT; server would do this in prod) ----
      const win2 = window as unknown as Record<string, unknown>;
      const SR = (win2.SpeechRecognition as SpeechRecognitionCtor | undefined) ??
        (win2.webkitSpeechRecognition as SpeechRecognitionCtor | undefined);
      if (SR) {
        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-US";
        rec.onresult = (ev: SpeechRecognitionEventLike) => {
          let interimTxt = "";
          let finalTxt = "";
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) finalTxt += r[0].transcript;
            else interimTxt += r[0].transcript;
          }
          if (interimTxt) setInterim(interimTxt);
          if (finalTxt) handleUserFinal(finalTxt);
        };
        rec.onerror = () => {};
        try {
          rec.start();
        } catch {}
        recognitionRef.current = rec;
      } else {
        // no browser STT -> demo echo so UI still feels realtime
        setInterim("listening…");
        setTimeout(() => streamAgentReply("hello"), 1200);
      }
    } catch (e: unknown) {
      setStatus("error");
      const msg = e instanceof Error ? e.message : "Microphone blocked. Allow mic access and retry.";
      setError(msg);
    }
  }, [handleUserFinal, streamAgentReply]);

  // Re-run from any tap: if the context is still suspended, a tap-gesture
  // resume is the only thing that unlocks real mic levels.
  const resumeAudio = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      mutedRef.current = next;
      if (next) {
        try {
          if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        } catch {}
      }
      return next;
    });
  }, []);

  const stop = useCallback(() => {
    if (agentTimer.current) clearTimeout(agentTimer.current);
    try {
      recognitionRef.current?.stop?.();
    } catch {}
    try {
      recorderRef.current?.stop();
    } catch {}
    try {
      wsRef.current?.close();
    } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    try {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    } catch {}
    streamRef.current = null;
    analyserRef.current = null;
    recorderRef.current = null;
    wsRef.current = null;
    recognitionRef.current = null;
    setMicOn(false);
    setAgentSpeaking(false);
    setInterim("");
    setWsConnected(false);
    setMuted(false);
    mutedRef.current = false;
    setStatus("idle");
  }, []);

  useEffect(() => () => stop(), [stop]);

  return {
    status,
    micOn,
    agentSpeaking,
    messages,
    interim,
    error,
    wsConnected,
    muted,
    wsUrl: WS_URL,
    analyserRef,
    start,
    stop,
    resumeAudio,
    toggleMute,
    toggle: () => (status === "live" ? stop() : start()),
    sendText: handleUserFinal,
  };
}
