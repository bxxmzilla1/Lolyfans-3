import { formatTokens, tokensForCents } from "./tokens";

/** Creator-shaped BlurDrainer region (normalized 0–1 over the video box). */
export type BlurDrainerConfig = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** How many identical blur layers stack over the region. */
  layers: number;
  /** Stripe charge in cents for each tap that removes one layer.
   *  0 = free: taps cost nothing but the fan must verify their card first. */
  priceCents: number;
};

export function parseBlurDrainer(raw: unknown): BlurDrainerConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const x = Number(o.x);
  const y = Number(o.y);
  const w = Number(o.w);
  const h = Number(o.h);
  const layers = Math.round(Number(o.layers));
  const priceCents = Math.round(Number(o.priceCents));
  if (
    ![x, y, w, h].every((n) => Number.isFinite(n)) ||
    !Number.isFinite(layers) ||
    !Number.isFinite(priceCents)
  ) {
    return null;
  }
  if (w <= 0 || h <= 0 || layers < 1 || layers > 40 || priceCents < 0) return null;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
    w: Math.min(1, Math.max(0.05, w)),
    h: Math.min(1, Math.max(0.05, h)),
    layers,
    priceCents,
  };
}

export function blurDrainPriceLabel(cents: number): string {
  if (cents <= 0) return "FREE";
  return formatTokens(tokensForCents(cents));
}
