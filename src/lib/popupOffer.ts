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

/**
 * Verify popup: after a fan sends a configurable number of messages without
 * a card on file, a popup asks them to verify with a card (Stripe SetupIntent
 * — no charge) to prevent fraud and keep minors away from adult content.
 */
export type VerifyPopup = {
  enabled: boolean;
  /** Messages the fan must send before the popup appears. */
  messages: number;
};

export const DEFAULT_VERIFY_POPUP: VerifyPopup = {
  enabled: true,
  messages: 5,
};

/** Read a creator's verify popup config from their auth user_metadata. */
export function verifyPopupFromMetadata(meta: Record<string, unknown>): VerifyPopup {
  return {
    // Anything but an explicit false keeps it on (the default).
    enabled: meta.verify_popup_enabled !== false,
    messages: positiveInt(meta.verify_popup_messages, DEFAULT_VERIFY_POPUP.messages),
  };
}

export function offerPriceLabel(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/**
 * Welcome offer: a popup the fan sees once, right after signing up and
 * landing in the chat. It welcomes them, explains that photos and videos
 * unlock with Tokens, and offers a discounted starter pack. Like the
 * first-top-up offer, it only ever applies to a fan's very first purchase.
 */
export type WelcomeOffer = {
  enabled: boolean;
  /** Tokens the fan receives. */
  tokens: number;
  /** What the fan actually pays. */
  priceCents: number;
  /** The struck-through "original" price shown next to the offer. */
  originalCents: number;
};

export const DEFAULT_WELCOME_OFFER: WelcomeOffer = {
  enabled: true,
  tokens: packTotalTokens(OFFER_PACK),
  priceCents: FIRST_TOPUP_OFFER_PRICE_CENTS,
  originalCents: OFFER_PACK.priceCents,
};

/** Read a creator's welcome offer config from their auth user_metadata. */
export function welcomeOfferFromMetadata(meta: Record<string, unknown>): WelcomeOffer {
  return {
    // Anything but an explicit false keeps it on (the default).
    enabled: meta.welcome_offer_enabled !== false,
    tokens: positiveInt(meta.welcome_offer_tokens, DEFAULT_WELCOME_OFFER.tokens),
    priceCents: positiveInt(
      meta.welcome_offer_price_cents,
      DEFAULT_WELCOME_OFFER.priceCents
    ),
    originalCents: positiveInt(
      meta.welcome_offer_original_cents,
      DEFAULT_WELCOME_OFFER.originalCents
    ),
  };
}
