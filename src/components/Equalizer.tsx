"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  agentAnalyserRef?: React.MutableRefObject<AnalyserNode | null>;
  active: boolean;
  agentSpeaking: boolean;
};

// single center-peaked mountain, tallest in the middle
const REST = [0.22, 0.4, 0.65, 1, 0.65, 0.4, 0.22];
// still pulse position held when there is no voice
const REST_POSE = REST.map((r) => r * 0.55);
const MAX = 300;
const MAX_COMPACT = 190;
const MIN = 4;

// ONE glowing white pill waveform mixing both voices (4o voice-mode style):
// whoever is producing sound drives it — engine playback while the agent
// speaks, mic levels while you speak, still mountain when quiet.
// No voice = bars ease back to the rest pose and hold.
export default function Equalizer({ analyserRef, agentAnalyserRef, active, agentSpeaking }: Props) {
  const els = useRef<Array<HTMLSpanElement | null>>([]);
  const liveRef = useRef({ active, agentSpeaking });
  // phones (<640px): slimmer pills + shorter swing
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
    const smooth = [...REST_POSE];

    const rmsOf = (td: Uint8Array, gain: number) => {
      let sum = 0;
      for (let i = 0; i < td.length; i++) {
        const v = (td[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / td.length) * gain);
    };

    // mirror low/mid/high around the center bar: peak energy lands in the middle
    const mirrored = (fd: Uint8Array) => {
      const eLow = fd[Math.min(3, fd.length - 1)] / 255;
      const eMid1 = fd[Math.min(8, fd.length - 1)] / 255;
      const eMid2 = fd[Math.min(16, fd.length - 1)] / 255;
      const eHigh = fd[Math.min(28, fd.length - 1)] / 255;
      return [eHigh, eMid2, eMid1, eLow, eMid1, eMid2, eHigh];
    };

    const readLive = (an: AnalyserNode) => {
      if (!freq || !timed || freq.length !== an.frequencyBinCount) {
        freq = new Uint8Array(an.frequencyBinCount);
        timed = new Uint8Array(an.fftSize);
      }
      const fd: Uint8Array = freq;
      const td: Uint8Array = timed;
      an.getByteFrequencyData(fd as Uint8Array<ArrayBuffer>);
      an.getByteTimeDomainData(td as Uint8Array<ArrayBuffer>);
      const rms = rmsOf(td, 5);
      return mirrored(fd).map((band, i) => {
        const energy = Math.max(band * 1.15, rms);
        return Math.max(REST_POSE[i] ?? 0.1, 0.1 + energy * 0.9);
      });
    };

    const loop = () => {
      time += 0.1;
      const { active: isActive, agentSpeaking: isAgent } = liveRef.current;
      const mic = analyserRef.current;
      const aan = agentAnalyserRef?.current ?? null;

      let target: number[];
      if (isAgent && aan) {
        target = readLive(aan); // engine reply audio
      } else if (isAgent) {
        // speaking but no analyser tap: syllable-rate bursts
        const burst = 0.55 + 0.45 * Math.sin(time * 5.2) * Math.sin(time * 1.3 + 0.7);
        target = [0, 1, 2, 3, 4, 5, 6].map(
          (i) => REST[i] * (0.35 + 0.6 * Math.max(0.15, burst)) + Math.sin(time * 6.1 + i * 1.7) * 0.1
        );
      } else if (mic && isActive) {
        target = readLive(mic); // your voice
      } else {
        target = [...REST_POSE]; // quiet: hold the still pulse position
      }

      for (let i = 0; i < 7; i++) {
        const t = target[i] ?? 0.1;
        const s = smooth[i] ?? 0.1;
        // slow attack + slow release = smooth buttery motion
        smooth[i] = s + (t - s) * (t > s ? 0.35 : 0.08);
        const lv = Math.max(0, Math.min(1, smooth[i] ?? 0.1));
        const el = els.current[i];
        if (el) {
          el.style.height = `${Math.max(MIN, lv * maxRef.current)}px`;
          el.style.opacity = `${(0.1 + lv * 0.9).toFixed(3)}`;
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [analyserRef, agentAnalyserRef]);

  const mh = compact ? MAX_COMPACT : MAX;

  return (
    <div className={compact ? "flex h-[320px] items-center justify-center gap-3" : "flex h-[520px] items-center justify-center gap-5"} aria-hidden>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <span
          key={i}
          ref={(el) => {
            els.current[i] = el;
          }}
          className={
            compact
              ? "block w-5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.5),0_0_16px_rgba(255,255,255,0.25)]"
              : "block w-6 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.55),0_0_22px_rgba(255,255,255,0.28)]"
          }
          style={{ height: `${(REST_POSE[i] ?? 0.1) * mh}px`, opacity: 0.6 }}
        />
      ))}
    </div>
  );
}
