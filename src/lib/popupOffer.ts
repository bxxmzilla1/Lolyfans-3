import {
  TOKEN_PACKS,
  FIRST_TOPUP_OFFER_PACK_ID,
  FIRST_TOPUP_OFFER_PRICE_CENTS,
  packTotalTokens,
} from "./tokens";

/**
 * Per-creator config for the one-time first top-up offer (the $4.99 popup).
 * Stored in the creator's auth metadata; every field falls back to the
 * platform default so creators who never touched the tab keep working.
 */
export type PopupOffer = {
  /** Tokens the fan receives. */
  tokens: number;
  /** What the fan actually pays. */
  priceCents: number;
  /** The struck-through "original" price shown next to the offer. */
  originalCents: number;
  /** Seconds after the first locked media before the popup appears. */
  delaySeconds: number;
  /**
   * Whether the popup auto-appears after the fan's first locked media.
   * Off = no popup; the offer still shows highlighted in the fan's wallet.
   */
  popupEnabled: boolean;
  /**
   * Whether the offer shows highlighted in the fan's token pack list.
   * Off = packs display their normal prices (the popup can still run).
   */
  packEnabled: boolean;
};

const OFFER_PACK = TOKEN_PACKS.find((p) => p.id === FIRST_TOPUP_OFFER_PACK_ID)!;

export const DEFAULT_POPUP_OFFER: PopupOffer = {
  tokens: packTotalTokens(OFFER_PACK),
  priceCents: FIRST_TOPUP_OFFER_PRICE_CENTS,
  originalCents: OFFER_PACK.priceCents,
  delaySeconds: 7,
  popupEnabled: true,
  packEnabled: true,
};

function positiveInt(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Read a creator's offer config from their auth user_metadata. */
export function popupOfferFromMetadata(meta: Record<string, unknown>): PopupOffer {
  return {
    tokens: positiveInt(meta.offer_tokens, DEFAULT_POPUP_OFFER.tokens),
    priceCents: positiveInt(meta.offer_price_cents, DEFAULT_POPUP_OFFER.priceCents),
    originalCents: positiveInt(
      meta.offer_original_cents,
      DEFAULT_POPUP_OFFER.originalCents
    ),
    delaySeconds: positiveInt(
      meta.offer_delay_seconds,
      DEFAULT_POPUP_OFFER.delaySeconds
    ),
    // Anything but an explicit false keeps these on (the default).
    popupEnabled: meta.offer_popup_enabled !== false,
    packEnabled: meta.offer_pack_enabled !== false,
  };
}

export function offerPriceLabel(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
