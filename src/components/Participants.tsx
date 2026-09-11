"use client";

// Top-left queue: 10 people as thick lines. Nothing else.
export default function Participants() {
  return (
    <div className="flex items-center gap-1 sm:gap-[5px]" title="10 people chatting" aria-label="10 people in queue">
      {Array.from({ length: 10 }).map((_, i) => (
        <span key={i} className="h-5 w-1 rounded-full bg-white sm:h-7 sm:w-[5px]" aria-hidden />
      ))}
    </div>
  );
}
