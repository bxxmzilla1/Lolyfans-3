import "server-only";
import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { chargeChatDollars } from "@/lib/payments";
import {
  CPM_LIVE_MS,
  CPM_PRICE_CENTS_PER_MIN,
} from "@/lib/cpmShared";

export { CPM_PRICE_CENTS_PER_MIN };
/**
 * How often an active session is billed while the fan stays in chat. Minutes
 * accrue and are charged in one lump every 10 minutes (or on close) — never
 * minute-by-minute, so banks don't flag the card for rapid small charges.
 */
export const CPM_BILL_EVERY_MS = 10 * 60_000;
/** Unpaid minutes that trigger a bill outside the timer. */
export const CPM_BILL_EVERY_MIN = 10;

/** Main app origin (guest cookie + /chat live here). */
export function appOrigin(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_ORIGIN || "https://www.lolyfans.com")
    .trim()
    .replace(/\/+$/, "");
  return raw.includes("://") ? raw : `https://${raw}`;
}

export type CpmSession = {
  id: string;
  chat_id: string;
  owner_id: string;
  status: "active" | "ended";
  minutes_charged: number;
  started_at: string;
  last_active_at: string;
  ended_at: string | null;
};

export function newCpmCode(): string {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** Ensure the creator has a shareable Chat-per-minute link code. */
export async function ensureCpmLink(ownerId: string): Promise<string> {
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("cpm_links")
    .select("code")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (existing?.code) return existing.code as string;

  for (let i = 0; i < 5; i++) {
    const code = newCpmCode();
    const { data, error } = await db
      .from("cpm_links")
      .insert({ owner_id: ownerId, code })
      .select("code")
      .single();
    if (!error && data?.code) return data.code as string;
  }
  throw new Error("Could not create Chat per minute link");
}

/** Landing-page customization saved on the creator's CPM link. */
export type CpmLinkSettings = {
  /** Custom bullet points; null → the built-in default list. */
  benefits: string[] | null;
  /** "Available for N people only" scarcity counters; null → hidden. */
  slotsTotal: number | null;
  slotsLeft: number | null;
  /** Per-visitor countdown length in minutes; null/0 → no timer. */
  timerMinutes: number | null;
};

/**
 * Read the landing customization for a link code. Returns all-null defaults
 * when the columns don't exist yet (migration not run) or nothing was saved.
 */
export async function cpmLinkSettings(code: string): Promise<CpmLinkSettings> {
  const empty: CpmLinkSettings = {
    benefits: null,
    slotsTotal: null,
    slotsLeft: null,
    timerMinutes: null,
  };
  if (!code) return empty;
  const { data, error } = await supabaseAdmin()
    .from("cpm_links")
    .select("benefits, slots_total, slots_left, timer_minutes")
    .eq("code", code)
    .maybeSingle();
  if (error || !data) return empty;
  const benefits = Array.isArray(data.benefits)
    ? (data.benefits as unknown[])
        .filter((b): b is string => typeof b === "string" && !!b.trim())
        .slice(0, 8)
    : null;
  return {
    benefits: benefits && benefits.length ? benefits : null,
    slotsTotal: typeof data.slots_total === "number" ? data.slots_total : null,
    slotsLeft: typeof data.slots_left === "number" ? data.slots_left : null,
    timerMinutes:
      typeof data.timer_minutes === "number" && data.timer_minutes > 0
        ? data.timer_minutes
        : null,
  };
}

export async function ownerIdForCpmCode(code: string): Promise<string | null> {
  if (!code) return null;
  const { data } = await supabaseAdmin()
    .from("cpm_links")
    .select("owner_id")
    .eq("code", code)
    .maybeSingle();
  return (data?.owner_id as string | null) ?? null;
}

export async function activeCpmSession(
  chatId: string
): Promise<CpmSession | null> {
  const { data } = await supabaseAdmin()
    .from("cpm_sessions")
    .select("*")
    .eq("chat_id", chatId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as CpmSession | null) ?? null;
}

/**
 * Minutes still owed for active time only.
 *
 * Billable window is [started_at, last_active_at] — never past the last
 * heartbeat — so the idle grace period before we mark them Offline is not
 * charged. Already-paid minutes (including the upfront first minute) are
 * subtracted so the same minute is never billed twice.
 */
export function minutesOwed(session: CpmSession, now = Date.now()): number {
  const started = new Date(session.started_at).getTime();
  if (!Number.isFinite(started)) return 0;
  const lastActive = new Date(session.last_active_at).getTime();
  // Cap at last heartbeat so offline/idle gaps after they leave aren't billed.
  const asOf = Math.min(
    now,
    Number.isFinite(lastActive) ? lastActive : now
  );
  const elapsedMs = Math.max(0, asOf - started);
  // At least 1 minute once a session exists (covers the upfront card check).
  const elapsedMin = Math.max(1, Math.ceil(elapsedMs / 60_000) || 1);
  return Math.max(0, elapsedMin - (session.minutes_charged || 0));
}

/**
 * Charge `count` unpaid minutes on the fan's saved card. Returns false when
 * the charge fails (no card / declined) — caller should end the session.
 * Uses an optimistic lock on minutes_charged so parallel /end calls can't
 * double-bill the same minute.
 */
export async function chargeCpmMinutes(
  session: CpmSession,
  count: number
): Promise<boolean> {
  if (count <= 0) return true;
  const from = session.minutes_charged;
  const to = from + count;

  // Claim these minutes first — if another request already advanced the
  // counter, we skip the Stripe charge entirely (no double bill).
  const { data: claimed, error: claimErr } = await supabaseAdmin()
    .from("cpm_sessions")
    .update({ minutes_charged: to })
    .eq("id", session.id)
    .eq("minutes_charged", from)
    .select("id")
    .maybeSingle();
  if (claimErr || !claimed) {
    // Lost the race — refresh local counter and treat as already paid.
    const fresh = await activeCpmSession(session.chat_id);
    if (fresh) session.minutes_charged = fresh.minutes_charged;
    return true;
  }
  session.minutes_charged = to;

  const result = await chargeChatDollars({
    chatId: session.chat_id,
    amountCents: count * CPM_PRICE_CENTS_PER_MIN,
    kind: "cpm",
    description: `Chat per minute (${count} min)`,
    metadata: {
      sessionId: session.id,
      minutes: String(count),
      from: String(from),
      to: String(to),
    },
  }).catch(() => null);
  if (!result || !("paid" in result)) {
    // Roll the claim back so a retry can try again (don't leave them marked
    // paid when Stripe declined).
    await supabaseAdmin()
      .from("cpm_sessions")
      .update({ minutes_charged: from })
      .eq("id", session.id)
      .eq("minutes_charged", to);
    session.minutes_charged = from;
    return false;
  }
  return true;
}

/**
 * Start a new metering session. The first minute is charged upfront — that
 * one charge confirms the saved card still works before the fan starts
 * chatting. After that, only active minutes (heartbeat window) are billed.
 */
export async function startCpmSession(opts: {
  chatId: string;
  ownerId: string;
}): Promise<CpmSession | null> {
  const db = supabaseAdmin();
  // Settle any leftover active session properly (charge active time, then end)
  // — never silently drop it without billing.
  const leftover = await activeCpmSession(opts.chatId);
  if (leftover) await endCpmSession(leftover);

  const { data, error } = await db
    .from("cpm_sessions")
    .insert({
      chat_id: opts.chatId,
      owner_id: opts.ownerId,
      minutes_charged: 0,
    })
    .select("*")
    .single();
  if (error || !data) return null;
  const session = data as CpmSession;
  // Card check: bill minute 1 now. Declined → no session, no free chatting.
  if (!(await chargeCpmMinutes(session, 1))) {
    await db
      .from("cpm_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", session.id);
    return null;
  }
  return session;
}

/**
 * Bill any unpaid *active* minutes (up to last heartbeat) and mark ended.
 * Safe to call repeatedly — only the first caller that flips status→ended
 * performs the settle charge.
 */
export async function endCpmSession(session: CpmSession): Promise<void> {
  if (session.status === "ended") return;

  // Claim the end first so parallel pagehide/visibility/sendBeacon can't
  // each run a settle charge.
  const { data: claimed } = await supabaseAdmin()
    .from("cpm_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", session.id)
    .eq("status", "active")
    .select("*")
    .maybeSingle();
  if (!claimed) return; // already ended by another request

  const live = claimed as CpmSession;
  session.status = "ended";
  // Bill from last_active_at (inside minutesOwed) — not wall-clock idle time.
  const owed = minutesOwed(live, new Date(live.last_active_at).getTime());
  if (owed > 0) {
    session.minutes_charged = live.minutes_charged;
    await chargeCpmMinutes(session, owed);
  }
}

/**
 * Settle sessions whose fan went offline (no heartbeat). Uses the same
 * window as the creator "Active" badge so the moment they show Idle they
 * are charged and metering stops.
 */
export async function endStaleCpmSessions(ownerId: string): Promise<void> {
  const cutoff = new Date(Date.now() - CPM_LIVE_MS).toISOString();
  const { data } = await supabaseAdmin()
    .from("cpm_sessions")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("status", "active")
    .lt("last_active_at", cutoff)
    .limit(50);
  for (const row of data ?? []) {
    await endCpmSession(row as CpmSession);
  }
}

/**
 * Resume metering after a fan interaction (send a message, accept/unlock a
 * video, BlurDrainer tap). No-op if the chat isn't CPM, has no card, or
 * already has a live session. Opening /chat alone never calls this.
 */
export async function ensureCpmMetering(chatId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id, owner_id, cpm, stripe_payment_method_id")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat?.cpm || !chat.stripe_payment_method_id) return;
  if (await activeCpmSession(chatId)) return;
  await startCpmSession({ chatId, ownerId: chat.owner_id as string });
}
