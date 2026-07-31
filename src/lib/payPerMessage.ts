/**
 * Pay per Message: every fan message costs a creator-set price. Each fan gets
 * a free credit (dollar amount) on their balance when they accept the terms
 * (or immediately if the terms popup is turned off); messages spend that
 * credit first. Once it's gone they must have a verified card to keep
 * chatting. Further costs accrue on a per-chat owed balance that is
 * auto-charged to their card roughly once an hour.
 */
export type PayPerMessage = {
  enabled: boolean;
  /** Price of one fan message, in cents. */
  priceCents: number;
  /** Free money credited to each fan's balance when they start, in cents. */
  freeCreditCents: number;
  /** When false, fans never see the terms popup — credit is granted silently. */
  showPopup: boolean;
};

/** Format cents as a short dollar string ($5 / $5.50). */
export function formatPpmMoney(cents: number): string {
  const n = Math.max(0, cents) / 100;
  return `$${n.toFixed(2).replace(/\.00$/, "")}`;
}

/** Read a creator's Pay per Message config from their auth user_metadata. */
export function payPerMessageFromMetadata(
  meta: Record<string, unknown>
): PayPerMessage {
  const priceCents = Math.max(0, Math.round(Number(meta.ppm_price_cents)) || 0);
  // Prefer the free-credit setting; fall back to the old free-messages × price
  // so creators who haven't re-saved still get a sensible amount.
  let freeCreditCents = 0;
  if (meta.ppm_free_credit_cents != null && meta.ppm_free_credit_cents !== "") {
    freeCreditCents = Math.max(0, Math.round(Number(meta.ppm_free_credit_cents)) || 0);
  } else {
    const freeMessages = Math.max(0, Math.round(Number(meta.ppm_free_messages)) || 0);
    freeCreditCents = freeMessages * priceCents;
  }
  return {
    // Explicit opt-in and a real price — otherwise the feature is off.
    enabled: meta.ppm_enabled === true && priceCents > 0,
    priceCents,
    freeCreditCents,
    // Default on; only an explicit false hides the popup.
    showPopup: meta.ppm_show_popup !== false,
  };
}
