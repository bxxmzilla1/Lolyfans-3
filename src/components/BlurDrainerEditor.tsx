"use client";

import { useRef, useState } from "react";
import Portal from "./Portal";
import { mediaUrl } from "@/lib/utils";
import { useVideoContentBox } from "@/lib/useVideoContentBox";
import {
  blurDrainPriceLabel,
  type BlurDrainerConfig,
} from "@/lib/blurDrainer";

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Creator UI: place a freestyle square blur over a video preview, set layers
 * and price-per-tap, then confirm the BlurDrainer config for send.
 *
 * Coordinates are normalized to the VIDEO FRAME itself (not the preview box),
 * so the blur lands on the exact same spot in the fan's fullscreen player
 * regardless of letterboxing. The frame edges are outlined and the square is
 * clamped inside them.
 */
export default function BlurDrainerEditor({
  videoPath,
  videoSrc,
  initial,
  onSave,
  onCancel,
}: {
  /** Storage path resolved through mediaUrl(). */
  videoPath?: string;
  /** Direct URL (e.g. a blob: object URL for a not-yet-uploaded file). */
  videoSrc?: string;
  initial?: BlurDrainerConfig | null;
  onSave: (cfg: BlurDrainerConfig) => void;
  onCancel: () => void;
}) {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const frame = useVideoContentBox(containerEl, videoEl);
  const [rect, setRect] = useState<Rect>(
    initial
      ? { x: initial.x, y: initial.y, w: initial.w, h: initial.h }
      : { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
  );
  const [layers, setLayers] = useState(String(initial?.layers ?? 8));
  // Free mode: taps cost nothing but the fan must verify their card first.
  const [free, setFree] = useState(initial ? initial.priceCents === 0 : false);
  const [price, setPrice] = useState(
    initial && initial.priceCents > 0
      ? (initial.priceCents / 100).toFixed(2).replace(/\.00$/, "")
      : "0.99"
  );
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origin: Rect;
  } | null>(null);

  function onPointerDown(mode: "move" | "resize", e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...rect },
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || !frame) return;
    // Deltas relative to the video frame, so the square tracks the finger 1:1.
    const dx = (e.clientX - d.startX) / frame.width;
    const dy = (e.clientY - d.startY) / frame.height;
    if (d.mode === "move") {
      setRect({
        ...d.origin,
        x: Math.min(1 - d.origin.w, Math.max(0, d.origin.x + dx)),
        y: Math.min(1 - d.origin.h, Math.max(0, d.origin.y + dy)),
      });
    } else {
      const w = Math.min(1 - d.origin.x, Math.max(0.08, d.origin.w + dx));
      const h = Math.min(1 - d.origin.y, Math.max(0.08, d.origin.h + dy));
      setRect({ ...d.origin, w, h });
    }
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function save() {
    // Free mode is a single verification tap — no layer stacking needed.
    const layerN = free
      ? 1
      : Math.max(1, Math.min(40, Math.round(parseFloat(layers) || 0)));
    const cents = free
      ? 0
      : Math.max(1, Math.round((parseFloat(price.replace(/[^\d.]/g, "")) || 0) * 100));
    if (layerN < 1 || (!free && cents < 1)) {
      alert("Set layers and a price per tap");
      return;
    }
    onSave({ ...rect, layers: layerN, priceCents: cents });
  }

  const priceCents = free
    ? 0
    : Math.round((parseFloat(price.replace(/[^\d.]/g, "")) || 0) * 100);

  return (
    <Portal>
      <div className="fixed inset-0 z-[90] bg-black/80 flex items-end sm:items-center justify-center p-3 fade-up">
        <div
          className="w-full max-w-md bg-card border border-line rounded-2xl overflow-hidden shadow-2xl"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <p className="font-bold text-sm">BlurDrainer</p>
            <button
              type="button"
              onClick={onCancel}
              className="text-xs font-semibold text-muted"
            >
              Cancel
            </button>
          </div>

          <div className="p-3 space-y-3">
            <p className="text-xs text-muted">
              Drag the square to cover the area fans will unblur tap by tap. It
              stays inside the video edges.
            </p>
            <div
              ref={setContainerEl}
              className="relative w-full aspect-[9/16] max-h-[50vh] mx-auto rounded-xl overflow-hidden bg-black touch-none"
            >
              <video
                ref={setVideoEl}
                src={videoSrc ?? (videoPath ? mediaUrl(videoPath) : undefined)}
                muted
                playsInline
                loop
                autoPlay
                className="absolute inset-0 w-full h-full object-contain"
              />
              {frame && (
                <>
                  {/* Video frame edges — the blur can't leave this area */}
                  <div
                    aria-hidden
                    className="absolute border border-white/40 pointer-events-none"
                    style={{
                      left: frame.left,
                      top: frame.top,
                      width: frame.width,
                      height: frame.height,
                    }}
                  />
                  <div
                    className="absolute border-2 border-accent bg-accent/25 backdrop-blur-md cursor-move"
                    style={{
                      left: frame.left + rect.x * frame.width,
                      top: frame.top + rect.y * frame.height,
                      width: rect.w * frame.width,
                      height: rect.h * frame.height,
                    }}
                    onPointerDown={(e) => onPointerDown("move", e)}
                  >
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow pointer-events-none">
                      BLUR
                    </span>
                    <button
                      type="button"
                      aria-label="Resize"
                      className="absolute -right-1.5 -bottom-1.5 w-4 h-4 rounded-full bg-accent border-2 border-white"
                      onPointerDown={(e) => onPointerDown("resize", e)}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {!free && (
                <label className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted">Layers</span>
                  <input
                    value={layers}
                    onChange={(e) => setLayers(e.target.value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    className="w-14 bg-bg border border-line rounded-lg px-2 py-1.5 text-xs focus:border-accent"
                  />
                </label>
              )}
              {!free && (
                <label className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted">Per tap</span>
                  <span className="font-bold text-accent">$</span>
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
                    inputMode="decimal"
                    className="w-16 bg-bg border border-line rounded-lg px-2 py-1.5 text-xs focus:border-accent"
                  />
                </label>
              )}
              <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={free}
                  onChange={(e) => setFree(e.target.checked)}
                  className="accent-accent"
                />
                <span className="text-muted">Free · card verify</span>
              </label>
            </div>
            <p className="text-[11px] text-muted">
              {free
                ? "Fans unblur for free with a single tap, after verifying their card"
                : `Fans pay ${priceCents > 0 ? blurDrainPriceLabel(priceCents) : "$—"} each tap · ${Math.max(1, parseInt(layers, 10) || 1)} taps to fully clear`}
            </p>

            <button
              type="button"
              onClick={save}
              className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-bold"
            >
              Apply BlurDrainer
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
