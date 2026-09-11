"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { useLatency } from "@/hooks/useLatency";

const GITHUB_URL = "https://github.com/Se00n00";
const SLOTS = 10;
const GRAPH_MAX = 200; // ms full-scale

const DOT: Record<string, string> = {
  low: "bg-green-800", // dark green = low latency
  mid: "bg-amber-500",
  high: "bg-red-600", // red = highest latency
};

function LatencyGraph({ history, quality }: { history: number[]; quality: string }) {
  // fixed 30 slots, empty slots padded on the right: bars keep one thin
  // width from the first sample, grow leftward-to-right, newest lands right
  const filled = history.map((ms, i) => ({ i, ms: ms as number | null }));
  while (filled.length < 30) filled.push({ i: filled.length, ms: null });
  const data = filled;
  const lastColor = quality === "low" ? "#166534" : quality === "mid" ? "#f59e0b" : "#dc2626";
  const lastIdx = history.length - 1;

  return (
    <div className="max-w-40 flex-1 rounded-lg bg-zinc-100 p-1">
      <div className="rounded-md bg-white px-2 py-1">
        <div className="h-5 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="25%">
              <XAxis dataKey="i" hide />
              <YAxis hide domain={[0, GRAPH_MAX]} />
              <Bar dataKey="ms" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                {data.map((_, i) => (
                  <Cell key={i} fill={i === lastIdx ? lastColor : "#18181b"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// Bottom strip of the white card: latency + graph + queue slots + github.
// Clicks here must not toggle voice (page root toggles on tap).
export default function StatusStrip() {
  const { ms, history, quality } = useLatency();
  const [used, setUsed] = useState(0);

  // demo occupancy drift (0 = you talk directly, higher = queued behind)
  useEffect(() => {
    const id = setInterval(() => {
      setUsed((u) => Math.max(0, Math.min(8, u + (Math.random() > 0.6 ? 1 : Math.random() < 0.35 ? -1 : 0))));
    }, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-3 pt-4 text-black"
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
        {ms}ms
        <span className={`inline-block h-2 w-2 rounded-full ${DOT[quality]}`} />
      </span>

      <LatencyGraph history={history} quality={quality} />

      <span className="bg-amber-300 p-1 rounded">
        <span className="flex items-center gap-[3px] " title={`${used}/${SLOTS} slots in use`}>
          {Array.from({ length: SLOTS }).map((_, i) => (
            <span
              key={i}
              className={`h-6 w-2 rounded-[2px] ${i < used ? "bg-zinc-900" : "bg-white"}`}
              aria-hidden
            />
          ))}
        </span>
      </span>

      

      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub Se00n00"
        title="GitHub Se00n00"
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-center"
      >
        <img src="github.svg" className="h-8"></img>
      </a>
    </div>
  );
}
