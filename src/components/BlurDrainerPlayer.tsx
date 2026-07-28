"use client";

import { useEffect, useState } from "react";
import Portal from "./Portal";
import EmbeddedCardTopup from "./EmbeddedCardTopup";
import { mediaUrl } from "@/lib/utils";
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
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<{
    clientSecret: string;
    amountCents: number;
    country: string | null;
  } | null>(null);

  const remaining = Math.max(0, config.layers - cleared);
  const progress = config.layers > 0 ? cleared / config.layers : 1;

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
        if (typeof data.layersCleared === "number") {
          setCleared(data.layersCleared);
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

  async function tap() {
    if (busy || remaining <= 0 || card) return;
    setBusy(true);
    try {
      const res = await fetch("/api/payments/blur-drain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, embedded: elementsEnabled() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.layersCleared === "number") {
        setCleared(data.layersCleared);
        onProgress?.(data.layersCleared);
      } else if (res.ok && data.clientSecret) {
        setCard({
          clientSecret: data.clientSecret,
          amountCents: Number(data.amountCents ?? config.priceCents),
          country: data.country ?? null,
        });
      } else if (!res.ok) {
        alert(data.error || "Could not charge this tap");
      }
    } catch {
      alert("Could not charge this tap");
    }
    setBusy(false);
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
        setCleared(data.layersCleared);
        onProgress?.(data.layersCleared);
      }
    } catch {
      // webhook still records
    }
    setCard(null);
  }

  // Checkpoint marks along the progress track (every layer).
  const checkpoints = Array.from({ length: config.layers + 1 }, (_, i) => i);

  return (
    <Portal>
      <div className="fixed inset-0 z-[85] bg-black fade-up flex flex-col">
        <div className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-4 right-4 z-20 flex items-start justify-between gap-3 pointer-events-none">
          <div className="pointer-events-none">
            <p className="text-white text-lg font-extrabold tracking-tight drop-shadow-lg">
              {blurDrainPriceLabel(config.priceCents)}
              <span className="text-white/70 text-sm font-semibold ml-1.5">
                / tap
              </span>
            </p>
            <p className="text-white/75 text-xs font-medium mt-0.5 drop-shadow">
              Tap the screen to unblur
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="pointer-events-auto rounded-full bg-black/40 border border-white/20 text-white/80 text-xs font-medium px-3.5 py-1.5 backdrop-blur"
          >
            Close
          </button>
        </div>

        <button
          type="button"
          onClick={tap}
          disabled={busy || remaining <= 0 || !!card}
          className="relative flex-1 w-full min-h-0 disabled:cursor-default"
          aria-label="Tap to unblur one layer"
        >
          <video
            src={mediaUrl(videoPath)}
            autoPlay
            playsInline
            loop
            muted={false}
            controls={false}
            className="absolute inset-0 w-full h-full object-contain bg-black"
          />
          {/* Stacked blur layers — same shape; peel from the top each tap */}
          {remaining > 0 &&
            Array.from({ length: remaining }, (_, i) => (
              <span
                key={i}
                aria-hidden
                className="absolute pointer-events-none border border-white/10"
                style={{
                  left: `${config.x * 100}%`,
                  top: `${config.y * 100}%`,
                  width: `${config.w * 100}%`,
                  height: `${config.h * 100}%`,
                  backdropFilter: `blur(${6 + i * 2}px)`,
                  WebkitBackdropFilter: `blur(${6 + i * 2}px)`,
                  background:
                    i === remaining - 1
                      ? "rgba(0,0,0,0.18)"
                      : "rgba(255,255,255,0.04)",
                }}
              />
            ))}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/20">
              <span className="w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            </span>
          )}
        </button>

        {/* Progress bar with layer checkpoints */}
        <div className="relative z-20 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 bg-gradient-to-t from-black/80 to-transparent">
          <div className="flex items-center justify-between text-[11px] text-white/70 mb-1.5">
            <span>
              {cleared}/{config.layers} cleared
            </span>
            <span>
              {remaining > 0
                ? `${remaining} tap${remaining === 1 ? "" : "s"} left`
                : "Fully clear"}
            </span>
          </div>
          <div className="relative h-2.5 rounded-full bg-white/15">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-accent transition-all duration-300"
              style={{ width: `${progress * 100}%` }}
            />
            {checkpoints.map((i) => (
              <span
                key={i}
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full border ${
                  i <= cleared
                    ? "bg-accent border-white"
                    : "bg-white/20 border-white/40"
                }`}
                style={{ left: `${(i / config.layers) * 100}%` }}
              />
            ))}
          </div>
        </div>

        {card && (
          <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-black/60">
            <div className="w-full max-w-sm">
              <EmbeddedCardTopup
                clientSecret={card.clientSecret}
                amountCents={card.amountCents}
                label="Unblur tap"
                countryGuess={card.country}
                onSuccess={completeCard}
                onCancel={() => setCard(null)}
              />
            </div>
          </div>
        )}
      </div>
    </Portal>
  );
}
