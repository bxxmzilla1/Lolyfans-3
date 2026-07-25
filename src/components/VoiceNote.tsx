"use client";

import { useEffect, useRef, useState } from "react";
import { IconPlay, IconPause } from "./Icons";

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Static pseudo-waveform bars; deterministic per src so it doesn't flicker. */
function bars(src: string, count = 28): number[] {
  let seed = 0;
  for (let i = 0; i < src.length; i++) seed = (seed * 31 + src.charCodeAt(i)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    out.push(0.25 + (seed % 1000) / 1333);
  }
  return out;
}

/**
 * Voice note bubble: play/pause, a waveform that fills with progress (tap or
 * drag to seek), and the time readout. `mine` flips it to the on-accent color
 * scheme of the sender's own bubble.
 */
export default function VoiceNote({ src, mine }: { src: string; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const waveform = useRef(bars(src)).current;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setTime(audio.currentTime);
    const onMeta = () => {
      // Some browsers report Infinity for streamed webm until a seek happens.
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setTime(0);
      audio.currentTime = 0;
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnd);
    };
  }, []);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => {});
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = frac * duration;
    setTime(audio.currentTime);
  }

  const progress = duration > 0 ? time / duration : 0;
  const base = mine ? "bg-white/30" : "bg-muted/40";
  const fill = mine ? "bg-white" : "bg-accent";

  return (
    <div className="flex items-center gap-2.5 px-3.5 py-3 w-64 max-w-full select-none">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center transition-opacity active:opacity-80 ${
          mine ? "bg-white text-accent" : "bg-accent text-white"
        }`}
      >
        {playing ? (
          <IconPause className="w-4 h-4" />
        ) : (
          <IconPlay className="w-4 h-4 translate-x-[1px]" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className="flex items-center gap-[2px] h-7 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            seek(e);
          }}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          {waveform.map((h, i) => {
            const done = (i + 0.5) / waveform.length <= progress;
            return (
              <span
                key={i}
                className={`flex-1 rounded-full ${done ? fill : base}`}
                style={{ height: `${Math.round(h * 100)}%` }}
              />
            );
          })}
        </div>
        <p
          className={`text-[10px] font-semibold tabular-nums mt-0.5 ${
            mine ? "text-white/75" : "text-muted"
          }`}
        >
          {playing || time > 0 ? fmt(time) : fmt(duration)}
        </p>
      </div>
    </div>
  );
}
