"use client";

// Typed client for the 00 voice engine.
// Base URL comes from env (.env): NEXT_PUBLIC_API_BASE (default http://localhost:8003).
// NOTE: WS /v1/talk currently 404s on the engine, so turns go over REST
// (POST /v1/voice). Revisit if the socket route is mounted again.

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8003";

// float32 mono PCM rate of /v1/voice wav_b64 — probed 2026-09-11:
// 1721600-char b64 (~322800 samples) for ~13.5s of reply speech @ 24kHz,
// matching /v1/speak's 24000Hz WAV header.
export const VOICE_PCM_RATE = 24000;

export type Health = {
  ok: boolean;
  uptime_s: number;
  engine_loaded: boolean;
  missing: string[];
  vram_mb: number;
};

export type VoiceTurn = {
  text: string;
  reply: string;
  wav_b64: string;
  ttfa_s: number;
  total_s: number;
};

export class EngineError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${API_BASE}${path}`, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Spec: treat 503 as "wait 2s, retry once" (honors Retry-After when present).
async function fetchWithRetry(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let res = await fetchOnce(path, init, timeoutMs);
  if (res.status === 503) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? "2") || 2;
    await sleep(Math.min(retryAfter, 5) * 1000);
    res = await fetchOnce(path, init, timeoutMs);
  }
  return res;
}

async function throwForStatus(res: Response): Promise<never> {
  let detail = "";
  try {
    const body = await res.json();
    // 422 names the offending field — surface it.
    detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body).slice(0, 160);
  } catch {
    /* non-JSON body */
  }
  throw new EngineError(res.status, detail || `engine ${res.status}`);
}

export async function getHealth(timeoutMs = 2500): Promise<Health> {
  const res = await fetchOnce("/health", {}, timeoutMs);
  if (!res.ok) await throwForStatus(res);
  return (await res.json()) as Health;
}

export async function engineReady(): Promise<boolean> {
  try {
    const h = await getHealth();
    return h.ok && h.missing.length === 0;
  } catch {
    return false;
  }
}

// One full voice turn: utterance wav -> {text, reply, wav_b64}. wav <= 60s.
export async function voiceTurn(wav: Blob): Promise<VoiceTurn> {
  const form = new FormData();
  form.append("f", wav, "turn.wav");
  const res = await fetchWithRetry("/v1/voice", { method: "POST", body: form }, 90000);
  if (!res.ok) await throwForStatus(res);
  return (await res.json()) as VoiceTurn;
}

// base64 float32 mono PCM -> AudioBuffer (for /v1/voice wav_b64).
export function pcmB64ToBuffer(ctx: BaseAudioContext, b64: string, rate = VOICE_PCM_RATE): AudioBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const floats = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  const buf = ctx.createBuffer(1, floats.length, rate);
  buf.copyToChannel(floats as Float32Array<ArrayBuffer>, 0);
  return buf;
}

// Play a buffer through an analyser (drives the gray equalizer bars for real).
export function playThroughAnalyser(
  ctx: AudioContext,
  analyser: AnalyserNode,
  buf: AudioBuffer
): { stop: () => void; ended: Promise<void> } {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(analyser);
  analyser.connect(ctx.destination);
  let resolve: () => void = () => {};
  const ended = new Promise<void>((r) => (resolve = r));
  src.onended = () => resolve();
  src.start();
  return { stop: () => { try { src.stop(); } catch {} }, ended };
}

// AudioBuffer (any rate, any channels) -> 16-bit mono WAV Blob for upload.
// The engine only accepts 16kHz — anything else 500s with "engine error" —
// so always mix down + linear-resample to 16000Hz here.
export function bufferToWavBlob(buf: AudioBuffer, maxSeconds = 55, targetRate = 16000): Blob {
  const frames = Math.min(buf.length, Math.floor(buf.sampleRate * maxSeconds));
  const mono = new Float32Array(frames);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < frames; i++) mono[i] += d[i] / buf.numberOfChannels;
  }
  const ratio = buf.sampleRate / targetRate;
  const outFrames = Math.floor(frames / ratio);
  const out = new DataView(new ArrayBuffer(44 + outFrames * 2));
  const wstr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, "RIFF");
  out.setUint32(4, 36 + outFrames * 2, true);
  wstr(8, "WAVEfmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, targetRate, true);
  out.setUint32(28, targetRate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  wstr(36, "data");
  out.setUint32(40, outFrames * 2, true);
  for (let i = 0; i < outFrames; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = mono[Math.min(i0, frames - 1)];
    const b = mono[Math.min(i0 + 1, frames - 1)];
    const s = Math.max(-1, Math.min(1, a + (b - a) * frac));
    out.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}
