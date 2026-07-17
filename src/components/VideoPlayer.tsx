"use client";

import { useRef, useState } from "react";
import { IconPlay, IconPause, IconVolume, IconVolumeMute, IconExpand } from "./Icons";

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VideoPlayer({
  src,
  className = "",
  videoClassName = "",
}: {
  src: string;
  className?: string;
  videoClassName?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = videoRef.current;
    if (!v || !duration) return;
    v.currentTime = (Number(e.target.value) / 100) * duration;
    setProgress(v.currentTime);
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      wrapRef.current?.requestFullscreen?.();
    }
  }

  const pct = duration ? (progress / duration) * 100 : 0;

  return (
    <div
      ref={wrapRef}
      className={`relative group/video overflow-hidden bg-black/60 ${className}`}
    >
      {/* #t=0.001 makes browsers render the first frame as the thumbnail instead of black */}
      <video
        ref={videoRef}
        src={`${src}#t=0.001`}
        preload="metadata"
        playsInline
        className={`w-full object-contain cursor-pointer ${videoClassName}`}
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />

      {/* Center play button */}
      {!playing && (
        <button
          onClick={togglePlay}
          aria-label="Play"
          className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-accent text-white glow-accent flex items-center justify-center active:scale-95 transition-transform"
        >
          <IconPlay className="w-6 h-6 translate-x-0.5" />
        </button>
      )}

      {/* Controls bar */}
      <div
        className={`absolute bottom-0 inset-x-0 px-3 pb-2 pt-8 bg-gradient-to-t from-black/80 to-transparent flex items-center gap-2 transition-opacity ${
          playing ? "opacity-0 group-hover/video:opacity-100" : "opacity-100"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="text-white shrink-0"
        >
          {playing ? <IconPause className="w-4.5 h-4.5" /> : <IconPlay className="w-4.5 h-4.5" />}
        </button>
        <span className="text-white/80 text-[11px] tabular-nums shrink-0">
          {formatClock(progress)}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={pct}
          onChange={seek}
          className="video-range flex-1 min-w-0"
          style={{ "--fill": `${pct}%` } as React.CSSProperties}
          aria-label="Seek"
        />
        <span className="text-white/80 text-[11px] tabular-nums shrink-0">
          {formatClock(duration)}
        </span>
        <button
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          className="text-white shrink-0"
        >
          {muted ? <IconVolumeMute className="w-4.5 h-4.5" /> : <IconVolume className="w-4.5 h-4.5" />}
        </button>
        <button
          onClick={toggleFullscreen}
          aria-label="Fullscreen"
          className="text-white shrink-0"
        >
          <IconExpand className="w-4.5 h-4.5" />
        </button>
      </div>
    </div>
  );
}
