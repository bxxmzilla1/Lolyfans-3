"use client";

import { useEffect, useRef, useState } from "react";
import Portal from "./Portal";
import EmbeddedCardTopup from "./EmbeddedCardTopup";
import { mediaUrl } from "@/lib/utils";
import { useVideoContentBox } from "@/lib/useVideoContentBox";
import { elementsEnabled } from "@/lib/stripeClient";
import {
  blurDrainPriceLabel,
  type BlurDrainerConfig,
} from "@/lib/blurDrainer";

/**
 * Fullscreen BlurDrainer: video plays under a stacked square blur. Each tap
 * on the blur square (not the whole screen) is a one-tap card charge that
 * peels one layer. The first tap also unmutes the video.
 */
export default function BlurDrainerPlayer({
  videoPath,
  config,
  initialCleared = 0,
  messageId,
  onClose,
  onProgress,
}: {
  videoPath: string;
  config: BlurDrainerConfig;
  initialCleared?: number;
  messageId: string;
  onClose: () => void;
  onProgress?: (layersCleared: number) => void;
}) {
  const [cleared, setCleared] = useState(initialCleared);
  const [peelFlash, setPeelFlash] = useState(false);
  const [card, setCard] = useState<{
    clientSecret: string;
    amountCents: number;
    country: string | null;
    needsCard?: boolean;
  } | null>(null);
  const [cardNote, setCardNote] = useState<string | null>(null);
  const prevCleared = useRef(initialCleared);
  // Optimistic taps: the layer clears instantly; the charge settles in the
  // background. Track in-flight charges so a failure can revert one layer.
  const inflightRef = useRef(0);
  const [inflight, setInflight] = useState(0);
  // Blur coordinates are relative to the VIDEO FRAME (set in the editor), so
  // map them onto the frame's real on-screen rect, excluding letterbox bars.
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const frame = useVideoContentBox(containerEl, videoEl);

  const remaining = Math.max(0, config.layers - cleared);
  const progress = config.layers > 0 ? cleared / config.layers : 1;
  // How fogged the region still is (1 = untouched, 0 = fully paid off).
  const fog = remaining <= 0 ? 0 : Math.pow(remaining / config.layers, 0.85);
  const blurPx = fog * 36;
  const frost = fog * 0.42;

  useEffect(() => {
    if (cleared > prevCleared.current) {
      setPeelFlash(true);
      const t = setTimeout(() => setPeelFlash(false), 420);
      prevCleared.current = cleared;
      return () => clearTimeout(t);
    }
    prevCleared.current = cleared;
  }, [cleared]);

  useEffect(() => {
    setCleared(initialCleared);
  }, [initialCleared, messageId]);

  // Start the video WITH sound right away. The player always opens from a
  // user tap (Accept / play button), so unmuted playback is normally allowed.
  // If the browser still blocks it, fall back to muted playback (never a
  // static frame) and unmute on the first touch anywhere.
  useEffect(() => {
    if (!videoEl) return;
    let unmuteOnTouch: (() => void) | null = null;
    videoEl.defaultMuted = false;
    videoEl.muted = false;
    videoEl.play().catch(() => {
      videoEl.muted = true;
      videoEl.play().catch(() => {});
      unmuteOnTouch = () => {
        videoEl.muted = false;
        if (unmuteOnTouch) window.removeEventListener("pointerdown", unmuteOnTouch);
        unmuteOnTouch = null;
      };
      window.addEventListener("pointerdown", unmuteOnTouch);
    });
    return () => {
      if (unmuteOnTouch) window.removeEventListener("pointerdown", unmuteOnTouch);
    };
  }, [videoEl]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/payments/blur-drain?messageId=${messageId}`);
        if (!res.ok || !alive) return;
        const data = await res.json();
        // Don't overwrite optimistic progress while charges are settling.
        if (typeof data.layersCleared === "number" && inflightRef.current === 0) {
          setCleared((c) => Math.max(c, data.layersCleared));
          onProgress?.(data.layersCleared);
        }
      } catch {
        // keep local
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  /** Instant unblur: peel the layer now, settle the charge in the background.
   *  If the payment fails, the layer fogs back and the card form explains. */
  async function tap() {
    if (card || cleared + inflightRef.current >= config.layers) return;
    setCleared((c) => Math.min(config.layers, c + 1));
    inflightRef.current += 1;
    setInflight(inflightRef.current);
    try {
      const res = await fetch("/api/payments/blur-drain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, embedded: elementsEnabled() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.layersCleared === "number") {
        onProgress?.(data.layersCleared);
      } else if (res.ok && data.clientSecret) {
        // No saved card (or charge failed) — refog and show the card sheet
        // under the still-playing video.
        setCleared((c) => Math.max(0, c - 1));
        const needsCard = !!data.needsCard;
        setCardNote(
          needsCard
            ? "Add your card below to unblur — each tap is one charge."
            : "Your payment didn't go through. Check your card details to keep unblurring."
        );
        setCard({
          clientSecret: data.clientSecret,
          amountCents: Number(data.amountCents ?? config.priceCents),
          country: data.country ?? null,
          needsCard,
        });
      } else {
        setCleared((c) => Math.max(0, c - 1));
      }
    } catch {
      setCleared((c) => Math.max(0, c - 1));
    } finally {
      inflightRef.current = Math.max(0, inflightRef.current - 1);
      setInflight(inflightRef.current);
    }
  }

  async function completeCard(paymentIntentId: string) {
    try {
      const res = await fetch("/api/payments/blur-drain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, paymentIntentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.layersCleared === "number") {
        setCleared((c) => Math.max(c, data.layersCleared));
        onProgress?.(data.layersCleared);
        if (videoEl) videoEl.play().catch(() => {});
      }
    } catch {
      // webhook still records
    }
    setCard(null);
    setCardNote(null);
  }

  // Checkpoint marks along the progress track (every layer).
  const checkpoints = Array.from({ length: config.layers + 1 }, (_, i) => i);
  const blurLabel =
    remaining > 0
      ? `Tap (${remaining}) to unblur full video`
      : "Tap to unblur";

  return (
    <Portal>
      <div className="fixed inset-0 z-[85] bg-black fade-up flex flex-col">
        <div className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-4 right-4 z-20 flex items-start justify-between gap-3 pointer-events-none">
          <p className="text-white text-lg font-extrabold tracking-tight drop-shadow-lg select-none">
            LolyFans
          </p>
          <div className="flex flex-col items-end gap-1.5 text-right pointer-events-auto">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-black/40 border border-white/20 text-white/80 text-xs font-light px-3.5 py-1.5 backdrop-blur"
            >
              Close
            </button>
            <p className="text-white/80 text-sm font-light tracking-wide drop-shadow tabular-nums">
              {blurDrainPriceLabel(config.priceCents)} / tap
            </p>
          </div>
        </div>

        {/* Video fills the area; only the blur square itself is tappable. */}
        <div ref={setContainerEl} className="relative flex-1 w-full min-h-0">
          <video
            ref={setVideoEl}
            src={mediaUrl(videoPath)}
            autoPlay
            playsInline
            loop
            controls={false}
            onCanPlay={(e) => {
              // Second chance in case the play() in the effect ran before the
              // source was ready.
              const v = e.currentTarget;
              if (v.paused) v.play().catch(() => {});
            }}
            onEnded={(e) => {
              const v = e.currentTarget;
              v.currentTime = 0;
              v.play().catch(() => {});
            }}
            className="absolute inset-0 w-full h-full object-contain bg-black pointer-events-none"
          />
          {frame && remaining > 0 && (
            <button
              type="button"
              onClick={tap}
              disabled={!!card}
              aria-label={blurLabel}
              className="absolute z-10 border border-white/20 overflow-hidden transition-[backdrop-filter,background-color,opacity] duration-500 ease-out disabled:opacity-70"
              style={{
                left: frame.left + config.x * frame.width,
                top: frame.top + config.y * frame.height,
                width: config.w * frame.width,
                height: config.h * frame.height,
                backdropFilter: `blur(${blurPx}px)`,
                WebkitBackdropFilter: `blur(${blurPx}px)`,
                backgroundColor: `rgba(8, 12, 20, ${frost})`,
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
              }}
            >
              <span className="absolute inset-0 flex items-center justify-center px-3 text-center pointer-events-none">
                <span className="text-white/85 text-xl sm:text-2xl font-thin tracking-wide drop-shadow-lg select-none leading-snug">
                  {blurLabel}
                </span>
              </span>
            </button>
          )}
          {frame && peelFlash && (
            <span
              aria-hidden
              className="absolute pointer-events-none animate-pulse z-10"
              style={{
                left: frame.left + config.x * frame.width,
                top: frame.top + config.y * frame.height,
                width: config.w * frame.width,
                height: config.h * frame.height,
                boxShadow: "inset 0 0 40px rgba(0,175,240,0.45)",
                background: "rgba(0,175,240,0.12)",
              }}
            />
          )}
        </div>

        {/* Minimal progress: slim bar + checkpoints, quiet labels */}
        <div className="relative z-20 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 bg-gradient-to-t from-black/70 to-transparent">
          <div className="flex items-center justify-between text-[11px] text-white/50 font-light mb-2">
            <span className="tabular-nums">
              {cleared}/{config.layers}
            </span>
            <span className="flex items-center gap-1.5">
              {inflight > 0 && (
                <span className="w-3 h-3 rounded-full border border-white/30 border-t-white/80 animate-spin" />
              )}
              {remaining > 0
                ? `${remaining} tap${remaining === 1 ? "" : "s"} left`
                : "Fully clear"}
            </span>
          </div>
          <div className="relative h-1.5 rounded-full bg-white/10">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-accent transition-all duration-300"
              style={{ width: `${progress * 100}%` }}
            />
            {checkpoints.map((i) => (
              <span
                key={i}
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${
                  i <= cleared ? "bg-white" : "bg-white/25"
                }`}
                style={{ left: `${(i / config.layers) * 100}%` }}
              />
            ))}
          </div>
        </div>

        {card && (
          <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col justify-end pointer-events-none">
            {/* Soft dim so the video stays visible above the sheet */}
            <div className="flex-1 min-h-[20vh] bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
            <div className="pointer-events-auto w-full max-h-[min(72vh,640px)] overflow-y-auto rounded-t-3xl border-t border-white/15 bg-card px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,0,0,0.45)] space-y-2">
              <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-line" />
              {cardNote && (
                <p
                  className={`rounded-xl text-xs font-light px-3.5 py-2.5 text-center ${
                    card.needsCard
                      ? "bg-accent/10 border border-accent/30 text-fg"
                      : "bg-red-500/15 border border-red-500/40 text-red-200"
                  }`}
                >
                  {cardNote}
                </p>
              )}
              <EmbeddedCardTopup
                clientSecret={card.clientSecret}
                amountCents={card.amountCents}
                label="Unblur tap"
                countryGuess={card.country}
                onSuccess={completeCard}
                onCancel={() => {
                  setCard(null);
                  setCardNote(null);
                }}
              />
            </div>
          </div>
        )}
      </div>
    </Portal>
  );
}
