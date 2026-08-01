/**
 * PaidSub: the creator can push a popup into a fan's chat offering their
 * first Token top-up at a discount — paying also unlocks unlimited messaging
 * (Pay per Message metering is skipped for that chat forever).
 */
export type PaidSub = {
  enabled: boolean;
  /** Tokens credited on payment (their first top-up pack). */
  tokens: number;
  /** Discounted price the fan pays, in cents. */
  priceCents: number;
  /** Struck-through "was" price shown next to the offer. */
  originalCents: number;
};

export const DEFAULT_PAID_SUB: PaidSub = {
  enabled: false,
  tokens: 1300,
  priceCents: 499,
  originalCents: 999,
};

function positiveInt(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Read a creator's PaidSub config from their auth user_metadata. */
export function paidSubFromMetadata(meta: Record<string, unknown>): PaidSub {
  return {
    enabled: meta.paidsub_enabled === true,
    tokens: positiveInt(meta.paidsub_tokens, DEFAULT_PAID_SUB.tokens),
    priceCents: positiveInt(meta.paidsub_price_cents, DEFAULT_PAID_SUB.priceCents),
    originalCents: positiveInt(
      meta.paidsub_original_cents,
      DEFAULT_PAID_SUB.originalCents
    ),
  };
}

/** "$5" / "$4.99" — dollar label for the one-time price. */
export function paidSubPriceLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}
