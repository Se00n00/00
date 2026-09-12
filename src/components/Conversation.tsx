"use client";

import type { ChatMsg } from "@/hooks/useVoiceAgent";

// Fading talk: newest message opacity 1 centered, older ones fade + disappear upward.
export default function Conversation({
  messages,
  interim,
}: {
  messages: ChatMsg[];
  interim: string;
}) {
  const items: ChatMsg[] = interim
    ? [...messages.slice(-3), { id: "__interim", role: "user", text: interim, ts: 0 }]
    : messages.slice(-4);

  const opacities = [0.12, 0.3, 0.55, 1].slice(4 - items.length);

  return (
    <div className="m-2 flex h-[calc(100%-1rem)] max-h-full min-h-0 w-[calc(100%-1rem)] flex-col overflow-hidden rounded-lg bg-white p-5 sm:p-6 lg:h-auto lg:min-h-0 lg:flex-1">
      <div className="flex w-full flex-1 items-center justify-center">
        <div className="flex w-full max-w-xl flex-col items-center justify-center gap-4 text-center [mask-image:linear-gradient(to_bottom,transparent,black_30%)]">
          {items.map((m, i) => (
            <p
              key={m.id}
              className={`font-roboto leading-snug font-medium transition-all duration-700 ${
                i === items.length - 1 ? "text-sm sm:text-base lg:text-lg" : "text-xs blur-[0.5px] sm:text-sm lg:text-base"
              } ${m.role === "user" ? "text-black" : "text-zinc-600"}`}
              style={{ opacity: opacities[i] ?? 1 }}
            >
              {m.text}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
