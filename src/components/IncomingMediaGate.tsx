"use client";

import Portal from "./Portal";
import { mediaUrl, mediaItemsFromMessage } from "@/lib/utils";
import type { Message } from "./MessageBubble";

function priceLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/**
 * Incoming-media gate: a creator photo/video takes over the whole screen,
 * blurred, until the fan decides. Accept shows it in the chat (priced media
 * charges the card first); Reject removes it for good. An optional
 * creator-set countdown auto-rejects when it runs out — it pauses while the
 * embedded card wizard is open (`wizard` renders in place of the buttons).
 */
export default function IncomingMediaGate({
  message,
  peerName,
  secondsLeft,
  busy,
  wizard,
  onAccept,
  onReject,
}: {
  message: Message;
  peerName?: string;
  /** Countdown seconds remaining; null = no time limit. */
  secondsLeft: number | null;
  busy: boolean;
  /** The embedded card wizard (first paid accept without a saved card). */
  wizard?: React.ReactNode;
  onAccept: () => void;
  onReject: () => void;
}) {
  const items = mediaItemsFromMessage(message).filter(
    (i) => i.type === "image" || i.type === "video"
  );
  const first = items[0];
  if (!first) return null;

  const price =
    message.locked && (message.price_cents ?? 0) > 0 ? message.price_cents! : 0;
  const timer =
    secondsLeft === null
      ? null
      : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <Portal>
      <div className="fixed inset-0 z-[80] bg-black fade-up">
        {/* The media itself, full screen and blurred */}
        {first.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl(first.path)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110"
          />
        ) : (
          <video
            src={mediaUrl(first.path)}
            muted
            autoPlay
            loop
            playsInline
            className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110"
          />
        )}
        <div className="absolute inset-0 bg-black/40" />

        {wizard ? (
          // First paid accept without a saved card: the 3-step card wizard
          // takes over; the parent pauses the countdown meanwhile.
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-sm">{wizard}</div>
          </div>
        ) : (
          <>
            <p className="absolute top-[max(1.1rem,env(safe-area-inset-top))] left-4 z-10 text-white text-lg font-extrabold tracking-tight drop-shadow-lg select-none">
              Lolyfans
            </p>

            <button
              type="button"
              onClick={onReject}
              disabled={busy}
              className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 z-10 rounded-full bg-black/40 border border-white/20 text-white/70 text-xs font-medium px-3.5 py-1.5 backdrop-blur active:opacity-70 disabled:opacity-40"
            >
              Reject
            </button>

            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
              <p className="mb-4 text-white text-2xl font-extrabold text-center leading-snug drop-shadow-lg">
                {peerName || "They"} sent you a{" "}
                {first.type === "video" ? "video" : "photo"}
                {items.length > 1 ? ` +${items.length - 1} more` : ""}
              </p>
              {/* Incoming-call effect: expanding ripple rings + a breathing button */}
              <div className="relative">
                {!busy && (
                  <>
                    <span
                      aria-hidden
                      className="call-ring absolute inset-0 rounded-full bg-accent/40"
                    />
                    <span
                      aria-hidden
                      className="call-ring call-ring-delay absolute inset-0 rounded-full bg-accent/30"
                    />
                  </>
                )}
                <button
                  type="button"
                  onClick={onAccept}
                  disabled={busy}
                  className={`relative rounded-full bg-accent text-white text-base font-bold px-14 py-3.5 shadow-2xl glow-accent active:opacity-80 disabled:opacity-60 flex items-center justify-center gap-2 ${
                    busy ? "" : "call-breathe"
                  }`}
                >
                  {busy && (
                    <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  )}
                  Accept
                </button>
              </div>
              {/* Price: very thin and faded, but still readable */}
              {price > 0 && (
                <p className="text-white/45 font-thin text-2xl tracking-widest tabular-nums drop-shadow">
                  {priceLabel(price)}
                </p>
              )}
            </div>

            {timer && (
              <p className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 text-white/50 text-sm font-medium tabular-nums drop-shadow">
                {timer}
              </p>
            )}
          </>
        )}
      </div>
    </Portal>
  );
}
