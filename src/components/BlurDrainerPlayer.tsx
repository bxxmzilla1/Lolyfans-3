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
 * is a one-tap card charge that peels one layer. Progress + checkpoints so
 * the fan can leave and come back later.
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
  // Curve so each early tap already shows a clear “more video” step.
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
        // Charge didn't go through — refog that layer and collect the card.
        setCleared((c) => Math.max(0, c - 1));
        setCardNote(
          "Your payment didn't go through. Check your card details to keep unblurring."
        );
        setCard({
          clientSecret: data.clientSecret,
          amountCents: Number(data.amountCents ?? config.priceCents),
          country: data.country ?? null,
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
      }
    } catch {
      // webhook still records
    }
    setCard(null);
    setCardNote(null);
  }

  // Checkpoint marks along the progress track (every layer).
  const checkpoints = Array.from({ length: config.layers + 1 }, (_, i) => i);

  return (
    <Portal>
      <div className="fixed inset-0 z-[85] bg-black fade-up flex flex-col">
        <div className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-4 right-4 z-20 flex items-start justify-between gap-3">
          <p className="text-white text-lg font-extrabold tracking-tight drop-shadow-lg select-none">
            LolyFans
          </p>
          <div className="flex flex-col items-end gap-1.5 text-right">
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
            <p className="text-white/60 text-xs font-light drop-shadow max-w-[11rem]">
              Tap the screen to unblur
            </p>
          </div>
        </div>

        <button
          type="button"
          ref={setContainerEl}
          onClick={tap}
          disabled={remaining <= 0 || !!card}
          className="relative flex-1 w-full min-h-0 disabled:cursor-default"
          aria-label="Tap to unblur one layer"
        >
          <video
            ref={setVideoEl}
            src={mediaUrl(videoPath)}
            autoPlay
            playsInline
            loop
            // Muted so mobile browsers allow continuous autoplay while the fan
            // taps through layers; onEnded is a fallback if loop is ignored.
            muted
            controls={false}
            onEnded={(e) => {
              const v = e.currentTarget;
              v.currentTime = 0;
              v.play().catch(() => {});
            }}
            className="absolute inset-0 w-full h-full object-contain bg-black"
          />
          {/* Progressive fog: each paid layer drops blur + frost so more video shows */}
          {frame && remaining > 0 && (
            <span
              aria-hidden
              className="absolute pointer-events-none border border-white/20 overflow-hidden transition-[backdrop-filter,background-color,opacity] duration-500 ease-out"
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
              <span className="absolute inset-0 flex items-center justify-center px-3 text-center">
                <span className="text-white/85 text-2xl font-thin tracking-wide drop-shadow-lg select-none">
                  Tap to unblur
                </span>
              </span>
            </span>
          )}
          {frame && peelFlash && (
            <span
              aria-hidden
              className="absolute pointer-events-none animate-pulse"
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
        </button>

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
          <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-black/60">
            <div className="w-full max-w-sm space-y-2">
              {cardNote && (
                <p className="rounded-xl bg-red-500/15 border border-red-500/40 text-red-200 text-xs font-light px-3.5 py-2.5 text-center">
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
