/** Client + server safe CPM helpers (no DB / Stripe imports). */

export const CPM_PRICE_CENTS_PER_MIN = 100;

/**
 * A session counts as live for the creator UI when the fan's heartbeat
 * updated within this window. Heartbeats fire every ~20s; 90s leaves room
 * for a missed tick without looking idle.
 */
export const CPM_LIVE_MS = 90_000;

/**
 * Active minutes for a session. Caps at lastActiveAt when provided so the
 * creator's "$ spent" matches what will actually be charged (no idle time).
 */
export function cpmElapsedMinutes(
  startedAt: string,
  now = Date.now(),
  lastActiveAt?: string | null
): number {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return 1;
  const last = lastActiveAt ? new Date(lastActiveAt).getTime() : NaN;
  const asOf = Number.isFinite(last) ? Math.min(now, last) : now;
  return Math.max(1, Math.ceil(Math.max(0, asOf - started) / 60_000) || 1);
}

/** Accrued spend in cents for active time only (elapsed minutes × $1). */
export function cpmEarnedCents(
  startedAt: string,
  now = Date.now(),
  lastActiveAt?: string | null
): number {
  return cpmElapsedMinutes(startedAt, now, lastActiveAt) * CPM_PRICE_CENTS_PER_MIN;
}

/** Fan still in chat — recent meter heartbeat. */
export function cpmSessionLive(
  lastActiveAt: string | null | undefined,
  now = Date.now()
): boolean {
  if (!lastActiveAt) return false;
  const t = new Date(lastActiveAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t < CPM_LIVE_MS;
}

export function formatCpmDollars(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
