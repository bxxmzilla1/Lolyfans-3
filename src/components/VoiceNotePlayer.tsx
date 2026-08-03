"use client";

import { useEffect, useRef, useState } from "react";

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
}

/**
 * Themed inline player for voice notes (chat bubbles and the composer
 * preview). `onAccent` flips the controls to white for the accent-colored
 * outgoing bubble.
 */
export default function VoiceNotePlayer({
  src,
  onAccent = false,
}: {
  src: string;
  onAccent?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    setCurrent(0);
    setDuration(0);
  }, [src]);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const el = audioRef.current;
    const bar = barRef.current;
    if (!el || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = frac * duration;
  }

  return (
    <div className="flex items-center gap-2.5 w-full min-w-44">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setDuration(d);
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setCurrent(el.currentTime);
          if (el.duration && Number.isFinite(el.duration)) {
            setDuration(el.duration);
            setProgress(el.currentTime / el.duration);
          }
        }}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-transform active:scale-95 ${
          onAccent ? "bg-white text-accent" : "bg-accent text-white"
        }`}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <rect x="6" y="5" width="4" height="14" rx="1.2" />
            <rect x="14" y="5" width="4" height="14" rx="1.2" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-4 h-4 translate-x-px"
          >
            <path d="M8 5.5a1 1 0 0 1 1.53-.85l10 6.5a1 1 0 0 1 0 1.7l-10 6.5A1 1 0 0 1 8 18.5v-13z" />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div
          ref={barRef}
          onClick={seek}
          className={`h-1.5 rounded-full cursor-pointer ${
            onAccent ? "bg-white/30" : "bg-line"
          }`}
        >
          <div
            className={`h-full rounded-full ${
              onAccent ? "bg-white" : "bg-accent"
            }`}
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
        <p
          className={`mt-1 text-[10px] font-medium tabular-nums ${
            onAccent ? "text-white/75" : "text-muted"
          }`}
        >
          {fmt(current)} / {duration ? fmt(duration) : "–:––"}
        </p>
      </div>
    </div>
  );
}
