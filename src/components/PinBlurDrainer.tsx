"use client";

import { useState } from "react";
import { JoinChannelSheet, goToChannel } from "./InviteSubscribeCta";
import { IconLock, IconPin } from "./Icons";

/**
 * Pinned BlurDrainer video at the top of a creator profile. The video is
 * always blurred — tapping "unblur" opens the signup sheet (invite pages) or
 * sends signed-up fans straight to the Telegram channel. It never unblurs.
 */
export default function PinBlurDrainer({
  url,
  ownerId,
  code,
}: {
  url: string;
  ownerId: string;
  /** Invite code when shown on an invite profile — taps open the signup sheet. */
  code?: string;
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
          <span className="w-14 h-14 rounded-2xl bg-[#3c68ff] flex items-center justify-center">
            <IconLock className="w-7 h-7 text-white" />
          </span>
          <span className="px-5 py-2.5 rounded-full bg-white/15 border border-white/30 backdrop-blur-md text-white text-sm font-semibold">
            {busy ? "Opening…" : "Tap to unblur"}
          </span>
        </span>
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
