"use client";

import { useEffect, useRef, useState } from "react";
import { IconPlay, IconPause, IconVolume, IconVolumeMute, IconExpand } from "./Icons";

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type VideoWithNativeFullscreen = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};

export default function VideoPlayer({
  src,
  className = "",
  videoClassName = "",
  fullscreenOnPlay = false,
}: {
  src: string;
  className?: string;
  videoClassName?: string;
  /** Chat mode: show only a play button; playing opens fullscreen with the full controls. */
  fullscreenOnPlay?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onFullscreenChange() {
      const fs = document.fullscreenElement === wrapRef.current;
      setIsFullscreen(fs);
      // Leaving fullscreen in chat mode returns to the thumbnail state
      if (!fs && fullscreenOnPlay) videoRef.current?.pause();
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [fullscreenOnPlay]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }

  async function handlePlayClick() {
    const v = videoRef.current as VideoWithNativeFullscreen | null;
    if (!v) return;
    if (fullscreenOnPlay && !isFullscreen) {
      const wrap = wrapRef.current;
      if (wrap?.requestFullscreen) {
        try {
          await wrap.requestFullscreen();
        } catch {
          // Fullscreen denied: just play inline
        }
      } else if (v.webkitEnterFullscreen) {
        // iPhone Safari: only the native video fullscreen is available
        v.webkitEnterFullscreen();
      }
      v.play();
      return;
    }
    togglePlay();
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
  const showControls = fullscreenOnPlay ? isFullscreen : true;

  return (
    <div
      ref={wrapRef}
      className={`video-wrap relative group/video overflow-hidden bg-black/60 ${className}`}
    >
      {/* #t=0.001 makes browsers render the first frame as the thumbnail instead of black */}
      <video
        ref={videoRef}
        src={`${src}#t=0.001`}
        preload="metadata"
        playsInline
        className={`w-full object-contain cursor-pointer ${videoClassName}`}
        onClick={handlePlayClick}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />

      {/* Center play button */}
      {!playing && (
        <button
          onClick={handlePlayClick}
          aria-label="Play"
          className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-accent text-white glow-accent flex items-center justify-center active:scale-95 transition-transform"
        >
          <IconPlay className="w-6 h-6 translate-x-0.5" />
        </button>
      )}

      {/* Controls bar */}
      {showControls && (
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
      )}
    </div>
  );
}
