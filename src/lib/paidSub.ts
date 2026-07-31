/**
 * PaidSub: the creator can push a popup into a fan's chat offering unlimited
 * messaging for a one-time payment (default $5). The popup blurs and blocks
 * the whole chat until the fan pays through the embedded Stripe card input.
 * Once paid, Pay per Message metering is skipped for that chat forever.
 */
export type PaidSub = {
  enabled: boolean;
  /** One-time price for unlimited messaging, in cents. */
  priceCents: number;
};

/** Read a creator's PaidSub config from their auth user_metadata. */
export function paidSubFromMetadata(meta: Record<string, unknown>): PaidSub {
  const priceCents =
    Math.max(0, Math.round(Number(meta.paidsub_price_cents)) || 0) || 500;
  return {
    enabled: meta.paidsub_enabled === true,
    priceCents,
  };
}

/** "$5" / "$4.99" — dollar label for the one-time price. */
export function paidSubPriceLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}
