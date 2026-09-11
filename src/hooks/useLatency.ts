"use client";

import { useEffect, useState } from "react";

export type LatencyQuality = "low" | "mid" | "high";

const MAX_HISTORY = 30;

// Simulated RTT (~23ms base with jitter + rare spikes).
// When the voice-agent server is wired (NEXT_PUBLIC_VOICE_WS_URL),
// replace the ticker with real ping/pong RTT over that socket.
export function useLatency() {
  const [history, setHistory] = useState<number[]>([23]);

  useEffect(() => {
    const id = setInterval(() => {
      const r = Math.random();
      const sample =
        r > 0.93
          ? 140 + Math.random() * 60 // occasional spike
          : 18 + Math.random() * 22 + Math.sin(Date.now() / 9000) * 4;
      setHistory((h) => [...h.slice(-(MAX_HISTORY - 1)), Math.round(sample)]);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const ms = history[history.length - 1] ?? 23;
  const quality: LatencyQuality = ms < 60 ? "low" : ms < 150 ? "mid" : "high";
  return { ms, history, quality };
}
