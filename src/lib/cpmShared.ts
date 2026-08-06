/** Client + server safe CPM helpers (no DB / Stripe imports). */

export const CPM_PRICE_CENTS_PER_MIN = 100;

/**
 * A session counts as live for the creator UI when the fan's heartbeat
 * updated within this window. Heartbeats fire every ~20s; 90s leaves room
 * for a missed tick without looking idle.
 */
export const CPM_LIVE_MS = 90_000;

/** Wall-clock minutes since session start (at least 1 while the session exists). */
export function cpmElapsedMinutes(startedAt: string, now = Date.now()): number {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return 1;
  return Math.max(1, Math.ceil((now - started) / 60_000));
}

/** Accrued earnings in cents for the current session (elapsed minutes × $1). */
export function cpmEarnedCents(startedAt: string, now = Date.now()): number {
  return cpmElapsedMinutes(startedAt, now) * CPM_PRICE_CENTS_PER_MIN;
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
