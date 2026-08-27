"use client";

import { useEffect, useRef, useState } from "react";
import Portal from "./Portal";
import EmbeddedCardTopup from "./EmbeddedCardTopup";
import { mediaUrl } from "@/lib/utils";
import { useVideoContentBox } from "@/lib/useVideoContentBox";
import { elementsEnabled } from "@/lib/stripeClient";
import { TOKEN_PACKS, packTotalTokens, formatTokens } from "@/lib/tokens";
import {
  blurDrainPriceLabel,
  type BlurDrainerConfig,
} from "@/lib/blurDrainer";

/**
 * Fullscreen BlurDrainer: video plays under a stacked square blur. Tapping
 * anywhere on the screen peels a layer instantly (pointer-down, optimistic —
 * the token spends run in the background), so rapid tapping never drops a
 * click. When the wallet can't cover a tap and auto-refill is off, the stuck
 * layer turns into a top-up layer: one deliberate tap on it buys a pack
 * (saved card = instant) and the layer clears automatically. Free drains
 * require card verification first.
 */
export default function BlurDrainerPlayer({
  videoPath,
  config,
  initialCleared = 0,
  messageId,
  chatId,
  onClose,
  onProgress,
}: {
  videoPath: string;
  config: BlurDrainerConfig;
  initialCleared?: number;
  messageId: string;
  chatId: string;
  onClose: () => void;
  onProgress?: (layersCleared: number) => void;
}) {
  const [cleared, setCleared] = useState(initialCleared);
  const [peelFlash, setPeelFlash] = useState(false);
  const [card, setCard] = useState<{
    clientSecret: string;
    country: string | null;
    mode: "setup" | "payment";
    amountCents: number;
  } | null>(null);
  const [cardNote, setCardNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Wallet too small for the next tap (and auto-refill didn't cover it):
  // the blur square becomes a top-up layer until the fan buys a pack.
  const [needTopup, setNeedTopup] = useState<{ needTokens: number } | null>(
    null
  );
  const prevCleared = useRef(initialCleared);
  const inflightRef = useRef(0);
  // Rapid taps outrun React state — refs keep the counters and guards exact
  // no matter how fast the fan hammers the screen.
  const tappedRef = useRef(initialCleared);
  const needTopupRef = useRef(false);
  const checkingRef = useRef(false);
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const frame = useVideoContentBox(containerEl, videoEl);

  const free = config.priceCents <= 0;
  const remaining = Math.max(0, config.layers - cleared);
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
    tappedRef.current = initialCleared;
    needTopupRef.current = false;
    setCleared(initialCleared);
    setNeedTopup(null);
  }, [initialCleared, messageId]);

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
        if (typeof data.layersCleared === "number" && inflightRef.current === 0) {
          tappedRef.current = Math.max(tappedRef.current, data.layersCleared);
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

  /** Peel one layer, reverting on failure. */
  function revertOneTap() {
    tappedRef.current = Math.max(0, tappedRef.current - 1);
    setCleared(tappedRef.current);
  }

  /** Unblur a layer. Paid taps peel instantly (optimistic) while the token
   *  spend runs in the background — every rapid tap counts, each firing its
   *  own spend. Free taps before card verification wait with a spinner so
   *  the blur never flashes open prematurely. */
  async function tap(force = false) {
    // Refs, not state: guards stay exact even when taps land faster than
    // React re-renders. `force` skips them for the automatic retry right
    // after a top-up (the state clearing them hasn't re-rendered yet).
    if (!force && (card || checkingRef.current || needTopupRef.current)) return;
    if (tappedRef.current >= config.layers) return;
    const optimistic = !free;
    if (optimistic) {
      tappedRef.current += 1;
      setCleared(tappedRef.current);
    } else {
      checkingRef.current = true;
      setChecking(true);
    }
    inflightRef.current += 1;
    try {
      const res = await fetch("/api/payments/blur-drain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, embedded: elementsEnabled() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 402 && typeof data.needTokens === "number") {
        // Auto-refill didn't cover it (switched off, no saved card, or the
        // charge failed): the blur square becomes a top-up layer.
        if (optimistic) revertOneTap();
        needTopupRef.current = true;
        setNeedTopup({ needTokens: data.needTokens });
        return;
      }
      if (res.ok && typeof data.layersCleared === "number") {
        tappedRef.current = Math.max(tappedRef.current, data.layersCleared);
        setCleared((c) => Math.max(c, data.layersCleared));
        onProgress?.(data.layersCleared);
      } else if (res.ok && data.setupClientSecret) {
        setCardNote("Verify your card below to unblur the video for free.");
        setCard({
          clientSecret: data.setupClientSecret,
          country: data.country ?? null,
          mode: "setup",
          amountCents: 0,
        });
      } else if (optimistic) {
        revertOneTap();
      }
    } catch {
      if (optimistic) revertOneTap();
    } finally {
      inflightRef.current = Math.max(0, inflightRef.current - 1);
      checkingRef.current = false;
      setChecking(false);
    }
  }

  /** The stuck layer's top-up: buy the smallest pack that covers the tap.
   *  Saved card charges instantly and the layer clears right away; first
   *  purchase opens the in-player card wizard instead. */
  async function topUp() {
    if (checkingRef.current || card) return;
    const pack =
      TOKEN_PACKS.find(
        (p) => packTotalTokens(p) >= (needTopup?.needTokens ?? 1)
      ) ?? TOKEN_PACKS[TOKEN_PACKS.length - 1];
    checkingRef.current = true;
    setChecking(true);
    try {
      const res = await fetch("/api/payments/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          packId: pack.id,
          embedded: elementsEnabled(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.topped) {
        // One-tap charge went through — pay for the stuck layer and continue.
        needTopupRef.current = false;
        setNeedTopup(null);
        checkingRef.current = false;
        setChecking(false);
        await tap(true);
        return;
      }
      if (res.ok && data.clientSecret) {
        setCardNote(
          `Top up ${formatTokens(packTotalTokens(pack))} to keep unblurring.`
        );
        setCard({
          clientSecret: data.clientSecret,
          country: data.country ?? null,
          mode: "payment",
          amountCents: data.amountCents ?? pack.priceCents,
        });
        return;
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch {
      // stays on the top-up layer — the fan can tap again
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }

  async function completeCard(intentId: string) {
    const mode = card?.mode ?? "setup";
    setCard(null);
    setCardNote(null);
    if (mode === "payment") {
      // Card top-up finished: credit the tokens, then automatically pay for
      // the layer the fan was stuck on and let them continue tapping.
      try {
        await fetch("/api/payments/topup/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, paymentIntentId: intentId }),
        });
      } catch {
        // the webhook still credits the payment
      }
      needTopupRef.current = false;
      setNeedTopup(null);
      if (videoEl) videoEl.play().catch(() => {});
      await tap(true);
      return;
    }
    try {
      const res = await fetch("/api/payments/blur-drain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, setupIntentId: intentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.layersCleared === "number") {
        tappedRef.current = Math.max(tappedRef.current, data.layersCleared);
        setCleared((c) => Math.max(c, data.layersCleared));
        onProgress?.(data.layersCleared);
        if (videoEl) videoEl.play().catch(() => {});
      }
    } catch {
      // webhook still records
    }
  }

  const freePrompt = free && cleared === 0;
  const blurLabel =
    remaining <= 0
      ? "Tap to unblur"
      : needTopup
        ? "You're out of Tokens"
        : freePrompt
          ? "Confirm your payment details to watch this video for FREE"
          : `Tap ${remaining} time${remaining === 1 ? "" : "s"} to unblur the video`;

  return (
    <Portal>
      {/* The whole screen is the tap surface: pointer-down (no click delay,
          no double-tap zoom) so hammering anywhere peels layers instantly. */}
      <div
        className="fixed inset-0 z-[85] bg-black fade-up flex flex-col touch-manipulation select-none"
        onPointerDown={() => {
          if (card || needTopupRef.current) return;
          if (remaining <= 0) return;
          void tap();
        }}
      >
        <div className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-4 right-4 z-20 flex items-start justify-between gap-3 pointer-events-none">
          <p className="text-white text-lg font-extrabold tracking-tight drop-shadow-lg select-none">
            LolyFans
          </p>
          <div
            className="flex flex-col items-end gap-1.5 text-right pointer-events-auto"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-black/40 border border-white/20 text-white/80 text-xs font-light px-3.5 py-1.5 backdrop-blur"
            >
              Close
            </button>
            <p className="text-white/80 text-sm font-light tracking-wide drop-shadow tabular-nums">
              {free ? "FREE" : `${blurDrainPriceLabel(config.priceCents)} / tap`}
            </p>
          </div>
        </div>

        <div ref={setContainerEl} className="relative flex-1 w-full min-h-0">
          <video
            ref={setVideoEl}
            src={mediaUrl(videoPath)}
            autoPlay
            playsInline
            loop
            controls={false}
            onCanPlay={(e) => {
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
            // The blur square itself: taps pass through to the full-screen
            // surface, except when it's the top-up layer — then it's a real
            // button so buying a pack takes a deliberate tap on it.
            <div
              role={needTopup ? "button" : undefined}
              tabIndex={needTopup ? 0 : undefined}
              onPointerDown={needTopup ? (e) => e.stopPropagation() : undefined}
              onClick={needTopup && !checking ? () => void topUp() : undefined}
              aria-label={blurLabel}
              className={`absolute z-10 border border-white/20 overflow-hidden transition-[backdrop-filter,background-color] duration-500 ease-out ${
                needTopup ? "cursor-pointer" : ""
              }`}
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
                {checking ? (
                  <span className="flex flex-col items-center gap-2.5">
                    <span
                      aria-hidden
                      className="h-8 w-8 rounded-full border-2 border-white/25 border-t-white/90 animate-spin drop-shadow-lg"
                    />
                    <span className="text-white/75 text-sm font-thin tracking-wide drop-shadow-lg select-none">
                      One moment…
                    </span>
                  </span>
                ) : needTopup ? (
                  <span className="flex flex-col items-center gap-2.5">
                    <span className="text-white/85 text-xl sm:text-2xl font-thin tracking-wide drop-shadow-lg select-none leading-snug">
                      {blurLabel}
                    </span>
                    <span className="px-4 py-2 rounded-full bg-accent text-white text-sm font-semibold shadow-lg select-none">
                      Tap to top up &amp; continue
                    </span>
                  </span>
                ) : freePrompt ? (
                  <span className="flex flex-col items-center gap-2">
                    <span className="text-white/85 text-xl sm:text-2xl font-thin tracking-wide drop-shadow-lg select-none leading-snug">
                      {blurLabel}
                    </span>
                    <span className="text-white/60 text-sm font-thin tracking-wide drop-shadow-lg select-none">
                      Tap here
                    </span>
                  </span>
                ) : (
                  <span className="text-white/85 text-xl sm:text-2xl font-thin tracking-wide drop-shadow-lg select-none leading-snug">
                    {blurLabel}
                  </span>
                )}
              </span>
            </div>
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

        {card && (
          <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col justify-end pointer-events-none">
            <div className="flex-1 min-h-[20vh] bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
            <div
              className="pointer-events-auto w-full max-h-[min(72vh,640px)] overflow-y-auto rounded-t-3xl border-t border-white/15 bg-card px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,0,0,0.45)] space-y-2"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-line" />
              {cardNote && (
                <p className="rounded-xl text-xs font-light px-3.5 py-2.5 text-center bg-accent/10 border border-accent/30 text-fg">
                  {cardNote}
                </p>
              )}
              <EmbeddedCardTopup
                clientSecret={card.clientSecret}
                mode={card.mode}
                amountCents={card.amountCents}
                presentAsVerify={card.mode === "setup"}
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
