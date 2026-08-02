"use client";

import { useState } from "react";
import { JoinChannelSheet, goToChannel } from "./InviteSubscribeCta";
import { IconLock, IconPin } from "./Icons";

/** Blur rectangle as fractions (0–1) of the video frame. */
export type BlurRegion = { x: number; y: number; w: number; h: number };

/**
 * Pinned BlurDrainer video at the top of a creator profile. The creator picks
 * a freestyle blur region; the video loops with only that area blurred (no
 * region saved = whole video blurred). Tapping opens the signup sheet (invite
 * pages) or sends signed-up fans straight to the Telegram channel — the blur
 * never comes off, even after signing up.
 */
export default function PinBlurDrainer({
  url,
  ownerId,
  code,
  region,
}: {
  url: string;
  ownerId: string;
  /** Invite code when shown on an invite profile — taps open the signup sheet. */
  code?: string;
  /** Creator-drawn blur area; null blurs the whole video. */
  region?: BlurRegion | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onTap() {
    if (code) {
      setOpen(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    await goToChannel(ownerId);
    setBusy(false);
  }

  const regionStyle = region
    ? {
        left: `${region.x * 100}%`,
        top: `${region.y * 100}%`,
        width: `${region.w * 100}%`,
        height: `${region.h * 100}%`,
      }
    : undefined;

  return (
    <article className="border-b border-line">
      <div className="flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-muted">
        <IconPin className="w-3.5 h-3.5" /> Pinned
      </div>

      <button
        type="button"
        onClick={() => void onTap()}
        className="relative block w-full overflow-hidden text-left"
        aria-label="Unblur this video"
      >
        {region ? (
          <>
            {/* w-full h-auto keeps the element at the video's intrinsic aspect
                ratio so the saved fractional region lines up exactly. */}
            <video
              src={url}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              className="w-full h-auto pointer-events-none select-none"
            />
            <span
              className="absolute rounded-lg"
              style={{
                ...regionStyle,
                backdropFilter: "blur(32px)",
                WebkitBackdropFilter: "blur(32px)",
                backgroundColor: "rgba(0,0,0,0.12)",
              }}
            />
            <span
              className="absolute flex flex-col items-center justify-center gap-2"
              style={regionStyle}
            >
              <span className="w-11 h-11 rounded-xl ig-gradient glow-accent flex items-center justify-center">
                <IconLock className="w-6 h-6 text-white" />
              </span>
              <span className="px-4 py-1.5 rounded-full bg-white/15 border border-white/30 backdrop-blur-md text-white text-xs font-semibold whitespace-nowrap">
                {busy ? "Opening…" : "Tap to unblur"}
              </span>
            </span>
          </>
        ) : (
          <>
            <video
              src={url}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              className="w-full h-auto max-h-[70vh] object-contain blur-2xl scale-110 pointer-events-none select-none"
            />
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/25">
              <span className="w-14 h-14 rounded-2xl ig-gradient glow-accent flex items-center justify-center">
                <IconLock className="w-7 h-7 text-white" />
              </span>
              <span className="px-5 py-2.5 rounded-full bg-white/15 border border-white/30 backdrop-blur-md text-white text-sm font-semibold">
                {busy ? "Opening…" : "Tap to unblur"}
              </span>
            </span>
          </>
        )}
      </button>

      {open && code && (
        <JoinChannelSheet
          code={code}
          ownerId={ownerId}
          onClose={() => setOpen(false)}
        />
      )}
    </article>
  );
}
