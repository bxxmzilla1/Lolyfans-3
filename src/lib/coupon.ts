/**
 * Creator-sent one-time Token coupons. Stored as a special message body so
 * they render as bubble cards in the chat and can be claimed once.
 */

export type CouponPayload = {
  id: string;
  tokens: number;
  priceCents: number;
  originalCents: number;
};

export const COUPON_PREFIX = "🎟️COUPON:";

export function formatCouponMessage(c: CouponPayload): string {
  return (
    COUPON_PREFIX +
    JSON.stringify({
      id: c.id,
      tokens: c.tokens,
      priceCents: c.priceCents,
      originalCents: c.originalCents,
    })
  );
}

export function parseCouponMessage(content: string | null | undefined): CouponPayload | null {
  if (!content || !content.startsWith(COUPON_PREFIX)) return null;
  try {
    const o = JSON.parse(content.slice(COUPON_PREFIX.length)) as Record<string, unknown>;
    const tokens = Math.round(Number(o.tokens));
    const priceCents = Math.round(Number(o.priceCents));
    const originalCents = Math.round(Number(o.originalCents));
    const id = typeof o.id === "string" ? o.id : "";
    if (!id || !(tokens > 0) || !(priceCents > 0) || !(originalCents > 0)) return null;
    return { id, tokens, priceCents, originalCents };
  } catch {
    return null;
  }
}
