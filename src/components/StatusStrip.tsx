"use client";

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
    <div className="w-40 shrink-0 rounded-xs bg-red-500 p-1">
      <div className="rounded-xs bg-white px-2 py-1">
        <div className="h-4 w-full">
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
  const { ms, history, quality, online } = useLatency();
  // no occupancy endpoint on the engine: 0 used = talk directly.
  // engine down => empty slots + flatline, never simulated.
  const used = 0;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="mt-4 inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-3 self-center rounded-lg border bg-white/12 px-2.5 py-1 border-white/14 text-white shadow-[0_1px_1px_rgba(0,0,0,0.35)] backdrop-blur-xl"
    >
      <span className="flex w-16 items-center gap-1.5 text-sm font-light tabular-nums" title={online ? "engine RTT" : "engine unreachable"}>
        {online && ms > 0 ? `${ms}ms` : "––"}
        <span className={`inline-block h-2 w-2 rounded-full ${DOT[quality]}`} />
      </span>

      <LatencyGraph history={history} quality={quality} />

      <span className="bg-amber-300 p-1 rounded-xs">
        <span className="flex items-center gap-[3px] " title={`${used}/${SLOTS} slots in use`}>
          {Array.from({ length: SLOTS }).map((_, i) => (
            <span
              key={i}
              className={`h-6 w-2 rounded-[1px] ${i < used ? "bg-white" : "bg-black"}`}
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
        className="flex items-center justify-center rounded-full"
      >
        <img src="github.svg" className="h-9"></img>
      </a>
    </div>
  );
}
