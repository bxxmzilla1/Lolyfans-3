/**
 * Pay per Message: every fan message costs a creator-set price. Each fan gets
 * a free allowance first; once it's used they must have a verified card to
 * keep chatting. Costs accrue on a per-chat balance that is auto-charged to
 * the fan's card roughly once an hour (never per message — banks decline
 * rapid-fire micro-charges).
 */
export type PayPerMessage = {
  enabled: boolean;
  /** Price of one fan message, in cents. */
  priceCents: number;
  /** How many messages each fan can send before billing starts. */
  freeMessages: number;
};

/** Read a creator's Pay per Message config from their auth user_metadata. */
export function payPerMessageFromMetadata(
  meta: Record<string, unknown>
): PayPerMessage {
  const priceCents = Math.max(0, Math.round(Number(meta.ppm_price_cents)) || 0);
  const freeMessages = Math.max(0, Math.round(Number(meta.ppm_free_messages)) || 0);
  return {
    // Explicit opt-in and a real price — otherwise the feature is off.
    enabled: meta.ppm_enabled === true && priceCents > 0,
    priceCents,
    freeMessages,
  };
}
