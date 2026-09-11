"use client";

import { useEffect } from "react";
import { useVoiceAgent } from "@/hooks/useVoiceAgent";
import type { ChatMsg } from "@/hooks/useVoiceAgent";
import Equalizer from "@/components/Equalizer";
import Conversation from "@/components/Conversation";

export default function Home() {
  const v = useVoiceAgent();

  // belt + suspenders vs zoom: Safari pinch gesture + desktop ctrl/trackpad zoom
  useEffect(() => {
    const stopGesture = (e: Event) => e.preventDefault();
    const stopCtrlWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    document.addEventListener("gesturestart", stopGesture);
    document.addEventListener("wheel", stopCtrlWheel, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", stopGesture);
      document.removeEventListener("wheel", stopCtrlWheel);
    };
  }, []);

  const handleTap = () => {
    if (v.status === "requesting") return;
    v.resumeAudio();
    v.toggle();
  };

  // Mic errors surface as talk text (UI stays 3 elements only).
  const display: ChatMsg[] = v.error
    ? [...v.messages, { id: "__mic-error", role: "agent", text: v.error, ts: 0 }]
    : v.messages;

  return (
    <div
      onClick={handleTap}
      onContextMenu={(e) => e.preventDefault()}
      title="tap to talk / mute"
      className="relative flex min-h-screen w-full cursor-pointer flex-col overflow-x-hidden bg-black text-white select-none lg:flex-row"
    >
      {/* 1st thing: disappearing talk — near full-bleed white card */}
      <section className="flex w-full min-w-0 flex-none items-center justify-center lg:min-h-screen lg:flex-1 lg:items-stretch">
        <Conversation messages={display} interim={v.interim} />
      </section>

      {/* 2nd thing: equalizer — right on desktop, down on mobile */}
      <aside className="flex w-full min-w-0 flex-none items-center justify-center px-5 pt-2 pb-10 sm:px-8 lg:min-h-screen lg:flex-1 lg:pb-6 lg:pr-16">
        <Equalizer analyserRef={v.analyserRef} active={v.status === "live" && v.micOn} agentSpeaking={v.agentSpeaking} />
      </aside>
    </div>
  );
}
