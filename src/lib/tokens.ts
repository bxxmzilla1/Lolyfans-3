/**
 * Token economy. Fans pay in Tokens, never in dollars, so spending inside the
 * chat feels detached from real money:
 *
 * - 1 token = 10¢ of creator-set price. A $5 unlock shows as "50 Tokens".
 * - Packs use charm prices ($9.99…) and grow bonus tokens with size, so the
 *   bigger packs read as obvious deals and balances land on big round numbers.
 * - The smallest pack (100 Tokens) already covers several unlocks, so a fan
 *   rarely faces the top-up screen at the exact moment they want content.
 */
export const CENTS_PER_TOKEN = 10;

/** Creator-set price in cents → tokens the fan pays. */
export function tokensForCents(cents: number): number {
  return Math.max(1, Math.ceil(cents / CENTS_PER_TOKEN));
}

export function formatTokens(n: number): string {
  return `${n.toLocaleString("en-US")} Token${n === 1 ? "" : "s"}`;
}

export type TokenPack = {
  id: string;
  /** Base tokens bought. */
  tokens: number;
  /** Free bonus tokens on top (the psychological sweetener). */
  bonusTokens: number;
  priceCents: number;
  tag?: string;
};

export const TOKEN_PACKS: TokenPack[] = [
  { id: "starter", tokens: 100, bonusTokens: 0, priceCents: 999 },
  { id: "plus", tokens: 250, bonusTokens: 25, priceCents: 2499, tag: "Most popular" },
  { id: "pro", tokens: 500, bonusTokens: 100, priceCents: 4999, tag: "+20% free" },
  { id: "vip", tokens: 1000, bonusTokens: 300, priceCents: 9999, tag: "Best value" },
];

/**
 * One-time offer for fans who have never topped up: the VIP pack at a huge
 * discount. The real goal is the first Stripe Checkout — it saves the card,
 * which turns every later top-up into a one-tap purchase.
 */
export const FIRST_TOPUP_OFFER_PACK_ID = "vip";
export const FIRST_TOPUP_OFFER_PRICE_CENTS = 499;

export function packById(id: string): TokenPack | null {
  return TOKEN_PACKS.find((p) => p.id === id) ?? null;
}

export function packTotalTokens(pack: TokenPack): number {
  return pack.tokens + pack.bonusTokens;
}

export function packPriceLabel(pack: TokenPack): string {
  const dollars = pack.priceCents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/**
 * Per-token cost, shown on the pack cards instead of the pack price — the
 * baseline is 10¢/token, so bigger packs read as an obvious per-token deal.
 */
export function perTokenLabel(priceCents: number, tokens: number): string {
  const cents = priceCents / Math.max(1, tokens);
  const rounded = Math.round(cents * 10) / 10;
  const str = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${str}¢ / Token`;
}

/** Tip amounts shown in the picker (tokens). */
export const TIP_TOKEN_PRESETS = [50, 100, 200, 500, 1000];
export const MIN_TIP_TOKENS = 10;
export const MAX_TIP_TOKENS = 50_000;
