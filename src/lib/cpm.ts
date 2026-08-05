import "server-only";
import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { chargeChatDollars } from "@/lib/payments";

export const CPM_PRICE_CENTS_PER_MIN = 100;
/** How often an active session is billed while the fan stays in chat. */
export const CPM_BILL_EVERY_MS = 30 * 60_000;

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
 * Minutes a session owes right now: wall-clock minutes since start (at least
 * 1 once the session exists), minus what's already been charged.
 */
export function minutesOwed(session: CpmSession, now = Date.now()): number {
  const started = new Date(session.started_at).getTime();
  const elapsedMin = Math.max(1, Math.ceil((now - started) / 60_000));
  return Math.max(0, elapsedMin - session.minutes_charged);
}

/**
 * Charge `count` unpaid minutes on the fan's saved card. Returns false when
 * the charge fails (no card / declined) — caller should end the session.
 */
export async function chargeCpmMinutes(
  session: CpmSession,
  count: number
): Promise<boolean> {
  if (count <= 0) return true;
  const result = await chargeChatDollars({
    chatId: session.chat_id,
    amountCents: count * CPM_PRICE_CENTS_PER_MIN,
    kind: "cpm",
    description: `Chat per minute (${count} min)`,
    metadata: { sessionId: session.id, minutes: String(count) },
  }).catch(() => null);
  if (!result || !("paid" in result)) return false;

  await supabaseAdmin()
    .from("cpm_sessions")
    .update({
      minutes_charged: session.minutes_charged + count,
      last_active_at: new Date().toISOString(),
    })
    .eq("id", session.id);
  session.minutes_charged += count;
  return true;
}

/** Start a new metering session and charge the first minute immediately. */
export async function startCpmSession(opts: {
  chatId: string;
  ownerId: string;
}): Promise<CpmSession | null> {
  const db = supabaseAdmin();
  // End any leftover active session for this chat first.
  await db
    .from("cpm_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("chat_id", opts.chatId)
    .eq("status", "active");

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
  if (!(await chargeCpmMinutes(session, 1))) {
    await db
      .from("cpm_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", session.id);
    return null;
  }
  return session;
}

/** Bill any unpaid minutes and mark the session ended. */
export async function endCpmSession(session: CpmSession): Promise<void> {
  if (session.status === "ended") return;
  const owed = minutesOwed(session);
  if (owed > 0) await chargeCpmMinutes(session, owed);
  await supabaseAdmin()
    .from("cpm_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", session.id)
    .eq("status", "active");
}
