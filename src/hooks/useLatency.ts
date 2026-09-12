"use client";

import { useEffect, useState } from "react";

export type LatencyQuality = "low" | "mid" | "high";

const MAX_HISTORY = 30;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8003";

// Real RTT to the engine (/health), sampled continuously.
// No simulated fallback: when the engine is unreachable the readout shows
// the outage (0ms flatline + red) instead of fake numbers.
export function useLatency() {
  const [history, setHistory] = useState<number[]>([0]);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    const tick = async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 1500);
        const t0 = performance.now();
        const res = await fetch(`${API_BASE}/health`, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) throw new Error(`health ${res.status}`);
        setOnline(true);
        const ms = Math.max(1, Math.round(performance.now() - t0));
        setHistory((h) => [...h.slice(-(MAX_HISTORY - 1)), ms]);
      } catch {
        setOnline(false);
        setHistory((h) => [...h.slice(-(MAX_HISTORY - 1)), 0]);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => clearInterval(id);
  }, []);

  const ms = history[history.length - 1] ?? 0;
  const quality: LatencyQuality = !online || ms <= 0 ? "high" : ms < 60 ? "low" : ms < 150 ? "mid" : "high";
  return { ms, history, quality, online };
}
