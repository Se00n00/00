"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EngineError,
  bufferToWavBlob,
  engineReady,
  pcmB64ToBuffer,
  playThroughAnalyser,
  voiceTurn,
} from "@/lib/backend";

export type ChatMsg = {
  id: string;
  role: "user" | "agent";
  text: string;
  ts: number;
  streaming?: boolean;
};

export type VoiceStatus = "idle" | "requesting" | "live" | "error";

// VAD turn-taking: speech onset starts a recording, ~1.2s of silence ends it.
const VAD_TICK_MS = 120;
const VAD_ONSET_RMS = 0.025;
const VAD_OFFSET_RMS = 0.015;
const VAD_SILENCE_MS = 1200;
const VAD_MIN_TURN_MS = 800;
const VAD_MAX_TURN_MS = 55000;

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
  const [backendLive, setBackendLive] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const agentAnalyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // server-turn plumbing
  const backendRef = useRef(false);
  const vadTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const vadBuf = useRef<Uint8Array | null>(null);
  const turnRef = useRef<{ active: boolean; silentMs: number; startedAt: number; chunks: Blob[] }>({
    active: false,
    silentMs: 0,
    startedAt: 0,
    chunks: [],
  });
  const inFlight = useRef(false);
  const playStop = useRef<(() => void) | null>(null);
  const lastNoteAt = useRef(0);

  const stopPlayback = useCallback(() => {
    try {
      playStop.current?.();
    } catch {}
    playStop.current = null;
  }, []);

  const noteFailure = useCallback((text: string) => {
    // don't spam the talk on repeated failures — one note per 10s max
    const now = Date.now();
    if (now - lastNoteAt.current < 10000) return;
    lastNoteAt.current = now;
    setMessages((m) => [...m, { id: uid(), role: "agent", text, ts: now }]);
  }, []);

  // One server turn: utterance audio -> engine -> text bubbles + real playback.
  // No local fallback: if the engine fails, the failure itself is shown.
  const processTurn = useCallback(
    async (blob: Blob) => {
      const ctx = audioCtxRef.current;
      if (!ctx || blob.size < 3000) return;
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
        const turn = await voiceTurn(bufferToWavBlob(decoded));
        if (turn.text?.trim()) {
          setMessages((m) => [...m, { id: uid(), role: "user", text: turn.text.trim(), ts: Date.now() }]);
        }
        const reply = (turn.reply ?? "").trim();
        if (reply) {
          setMessages((m) => [...m, { id: uid(), role: "agent", text: reply, ts: Date.now() }]);
        }
        if (turn.wav_b64) {
          const an = agentAnalyserRef.current;
          if (an) {
            stopPlayback();
            setAgentSpeaking(true);
            const h = playThroughAnalyser(ctx, an, pcmB64ToBuffer(ctx, turn.wav_b64));
            playStop.current = h.stop;
            await h.ended;
            setAgentSpeaking(false);
          }
        }
      } catch (e) {
        if (e instanceof EngineError) {
          noteFailure(e.code === 503 ? "engine busy — tap to retry" : `engine ${e.code}: ${e.message}`.slice(0, 120));
        } else {
          noteFailure("engine unreachable — tap to retry");
        }
      } finally {
        inFlight.current = false;
      }
    },
    [stopPlayback, noteFailure]
  );

  const tickVad = useCallback(() => {
    const an = analyserRef.current;
    const ctx = audioCtxRef.current;
    if (!an || !ctx || ctx.state !== "running") return;
    if (!vadBuf.current || vadBuf.current.length !== an.fftSize) {
      vadBuf.current = new Uint8Array(an.fftSize);
    }
    const td = vadBuf.current;
    an.getByteTimeDomainData(td as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < td.length; i++) {
      const v = (td[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / td.length);
    const t = turnRef.current;

    if (!t.active) {
      if (rms > VAD_ONSET_RMS && !inFlight.current) {
        try {
          const mime = ["audio/webm;codecs=opus", "audio/webm"].find((m) =>
            typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)
          );
          const rec = mime ? new MediaRecorder(streamRef.current!, { mimeType: mime }) : new MediaRecorder(streamRef.current!);
          t.chunks = [];
          rec.ondataavailable = (e) => {
            if (e.data.size > 0) t.chunks.push(e.data);
          };
          rec.onstop = () => {
            recorderRef.current = null;
            void processTurn(new Blob(t.chunks, { type: rec.mimeType || "audio/webm" }));
          };
          recorderRef.current = rec;
          rec.start();
          t.active = true;
          t.silentMs = 0;
          t.startedAt = Date.now();
        } catch {
          /* recorder unavailable — STT/demo path still works */
        }
      }
    } else {
      t.silentMs = rms < VAD_OFFSET_RMS ? t.silentMs + VAD_TICK_MS : 0;
      const dur = Date.now() - t.startedAt;
      if ((t.silentMs >= VAD_SILENCE_MS && dur > VAD_MIN_TURN_MS) || dur > VAD_MAX_TURN_MS) {
        t.active = false;
        try {
          recorderRef.current?.stop();
        } catch {}
      }
    }
  }, [processTurn]);

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

      // Dedicated analyser for engine playback -> drives gray bars for real.
      const agentAn = ctx.createAnalyser();
      agentAn.fftSize = 256;
      agentAn.smoothingTimeConstant = 0.8;
      agentAnalyserRef.current = agentAn;

      // Engine check: VAD turns only run when it is ready.
      // No fallback: without the engine there is no recognition or speech —
      // the strip + talk show the outage instead of faking it.
      const ready = await engineReady();
      backendRef.current = ready;
      setBackendLive(ready);
      if (!ready) {
        setError("engine offline — tap to retry");
      } else if (!vadTimer.current) {
        vadTimer.current = setInterval(tickVad, VAD_TICK_MS);
      }
    } catch (e: unknown) {
      setStatus("error");
      const msg = e instanceof Error ? e.message : "Microphone blocked. Allow mic access and retry.";
      setError(msg);
    }
  }, [tickVad]);

  // Re-run from any tap: if the context is still suspended, a tap-gesture
  // resume is the only thing that unlocks real mic levels.
  const resumeAudio = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  }, []);

  const stop = useCallback(() => {
    if (vadTimer.current) clearInterval(vadTimer.current);
    vadTimer.current = null;
    stopPlayback();
    turnRef.current = { active: false, silentMs: 0, startedAt: 0, chunks: [] };
    inFlight.current = false;
    backendRef.current = false;
    try {
      recorderRef.current?.stop();
    } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current = null;
    analyserRef.current = null;
    agentAnalyserRef.current = null;
    recorderRef.current = null;
    setMicOn(false);
    setAgentSpeaking(false);
    setInterim("");
    setBackendLive(false);
    setStatus("idle");
  }, [stopPlayback]);

  useEffect(() => () => stop(), [stop]);

  return {
    status,
    micOn,
    agentSpeaking,
    messages,
    interim,
    error,
    backendLive,
    analyserRef,
    agentAnalyserRef,
    start,
    stop,
    resumeAudio,
    toggle: () => (status === "live" ? stop() : start()),
  };
}
