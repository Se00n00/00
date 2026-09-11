"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  active: boolean;
  agentSpeaking: boolean;
};

const REST = [0.32, 0.55, 0.95, 0.55, 0.32];
// still pulse position held when there is no voice (peak in the center)
const REST_POSE = REST.map((r) => r * 0.55);
// idle only: assistant row sits lightly below the user row
const AGENT_REST = REST_POSE.map((r) => r * 0.85);
// the middle pair (center white + gray sticks) renders double height
const HEIGHT_GAIN = [1, 1, 2, 1, 1];
const GAIN_CAP = 1.7;
const MAX = 170;
const MAX_COMPACT = 110;
const MIN = 4;

// Small dual-color equalizer on black. No background / border / labels.
// White bars = YOUR mic, driven by the live AnalyserNode (RMS + spectrum,
// mirrored so the peak sits on the center bar).
// Gray bars = ASSISTANT, driven by agent-speaking envelope (word stream / TTS).
// No voice = both rows ease back to a still center-peaked pulse position.
export default function Equalizer({ analyserRef, active, agentSpeaking }: Props) {
  const userEls = useRef<Array<HTMLSpanElement | null>>([]);
  const agentEls = useRef<Array<HTMLSpanElement | null>>([]);
  const liveRef = useRef({ active, agentSpeaking });
  // phones (<640px): slimmer sticks + shorter swing so 10 bars fit ~360px wide
  const [compact, setCompact] = useState(false);
  const maxRef = useRef(MAX);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => {
      setCompact(mq.matches);
      maxRef.current = mq.matches ? MAX_COMPACT : MAX;
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    liveRef.current = { active, agentSpeaking };
  }, [active, agentSpeaking]);

  useEffect(() => {
    let raf = 0;
    let time = 0;
    let freq: Uint8Array | null = null;
    let timed: Uint8Array | null = null;
    const smoothUser = [...REST_POSE];
    const smoothAgent = [...AGENT_REST];

    const loop = () => {
      time += 0.1;
      const { active: isActive, agentSpeaking: isAgent } = liveRef.current;
      const an = analyserRef.current;

      let userTarget: number[];
      if (an && isActive) {
        if (!freq || !timed || freq.length !== an.frequencyBinCount) {
          freq = new Uint8Array(an.frequencyBinCount);
          timed = new Uint8Array(an.fftSize);
        }
        const fd: Uint8Array = freq;
        const td: Uint8Array = timed;
        an.getByteFrequencyData(fd as Uint8Array<ArrayBuffer>);
        an.getByteTimeDomainData(td as Uint8Array<ArrayBuffer>);

        let sum = 0;
        for (let i = 0; i < td.length; i++) {
          const v = (td[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.min(1, Math.sqrt(sum / td.length) * 5);
        const eLow = fd[Math.min(3, fd.length - 1)] / 255;
        const eMid = fd[Math.min(10, fd.length - 1)] / 255;
        const eHigh = fd[Math.min(28, fd.length - 1)] / 255;
        // mirror low/mid/high around the center bar: peak energy lands in the middle
        const barEnergy = [eHigh, eMid, eLow, eMid, eHigh];
        userTarget = barEnergy.map((band, i) => {
          const energy = Math.max(band * 1.15, rms);
          // rest pulse-position floor: silence settles into a still mountain
          return Math.max(REST_POSE[i] ?? 0.1, 0.1 + energy * 0.9);
        });
      } else {
        // mic off: hold the still pulse position
        userTarget = [...REST_POSE];
      }

      let agentTarget: number[];
      if (isAgent) {
        // syllable-rate bursts (~5Hz) + per-bar phase so it looks like speech
        const burst = 0.55 + 0.45 * Math.sin(time * 5.2) * Math.sin(time * 1.3 + 0.7);
        agentTarget = [0, 1, 2, 3, 4].map(
          (i) => REST[i] * (0.35 + 0.6 * Math.max(0.15, burst)) + Math.sin(time * 6.1 + i * 1.7) * 0.1
        );
      } else {
        agentTarget = [...AGENT_REST];
      }

      for (let i = 0; i < 5; i++) {
        const ut = userTarget[i] ?? 0.1;
        const at = agentTarget[i] ?? 0.1;
        // slow attack + slow release = smooth buttery motion
        const ua = smoothUser[i] ?? 0.1;
        const aa = smoothAgent[i] ?? 0.1;
        smoothUser[i] = ua + (ut - ua) * (ut > ua ? 0.35 : 0.08);
        smoothAgent[i] = aa + (at - aa) * (at > aa ? 0.35 : 0.08);
        const ul = Math.max(0, Math.min(1, smoothUser[i] ?? 0.1));
        const al = Math.max(0, Math.min(1, smoothAgent[i] ?? 0.1));
        const gain = HEIGHT_GAIN[i] ?? 1;
        const mh = maxRef.current;
        const u = userEls.current[i];
        // quiet -> opacity 0.1, loud -> opacity 1
        if (u) {
          u.style.height = `${Math.max(MIN, Math.min(GAIN_CAP, ul * gain) * mh)}px`;
          u.style.opacity = `${(0.1 + ul * 0.9).toFixed(3)}`;
        }
        const a = agentEls.current[i];
        if (a) {
          a.style.height = `${Math.max(MIN, Math.min(GAIN_CAP, al * gain) * mh)}px`;
          a.style.opacity = `${(0.1 + al * 0.9).toFixed(3)}`;
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [analyserRef]);

  const mh = compact ? MAX_COMPACT : MAX;
  const barClass = compact ? "block w-8 border-2 border-white-900 rounded-full" : "bg-white block w-8 border-4 border-white-900 rounded-full";

  return (
    <div className={compact ? "flex h-[200px] items-center justify-center gap-2" : "flex h-[320px] items-center justify-center gap-4"} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={compact ? "flex items-center gap-1" : "flex items-center gap-2"}>
          <span
            ref={(el) => {
              userEls.current[i] = el;
            }}
            className={barClass}
            style={{ height: `${Math.min(GAIN_CAP, (REST_POSE[i] ?? 0.1) * (HEIGHT_GAIN[i] ?? 1)) * mh}px`, opacity: 0.6 }}
          />
          <span
            ref={(el) => {
              agentEls.current[i] = el;
            }}
            className={barClass}
            style={{ height: `${Math.min(GAIN_CAP, (AGENT_REST[i] ?? 0.1) * (HEIGHT_GAIN[i] ?? 1)) * mh}px`, opacity: 0.15 }}
          />
        </span>
      ))}
    </div>
  );
}
