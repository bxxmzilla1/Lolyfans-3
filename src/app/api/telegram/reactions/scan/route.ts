import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { tgSessionFor, telegramConfigured } from "@/lib/telegram";
import {
  chargeReactionUnlocks,
  retryUndeliveredUnlocks,
} from "@/lib/telegramUnlock";
import { cacheVaultBacklog } from "@/lib/telegramMediaCache";

export const dynamic = "force-dynamic";
// The background loop runs ~50s per cron tick; deliveries can add more.
export const maxDuration = 300;

// How long one cron invocation keeps scanning, and how often it re-checks.
// The next cron tick (1/min) takes over right as this window closes, so
// reactions are picked up within a few seconds around the clock.
const LOOP_WINDOW_MS = 50_000;
const LOOP_STEP_MS = 5_000;

// One loop per warm instance — overlapping crons just ack and exit.
let loopRunning = false;

/** One pass: retry undelivered media, then charge new reactions. */
async function scanOnce(): Promise<void> {
  // Creators worth visiting: pending teasers (reactions to charge) plus
  // paid-but-undelivered unlocks (deliveries to retry).
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const db = supabaseAdmin();
  const [{ data: pending }, { data: undelivered }] = await Promise.all([
    db
      .from("telegram_unlocks")
      .select("owner_id")
      .eq("status", "pending")
      .not("tg_message_id", "is", null)
      .gte("created_at", since)
      .limit(200),
    db
      .from("telegram_unlocks")
      .select("owner_id")
      .in("status", ["paid", "delivering"])
      .is("delivered_at", null)
      .gte("created_at", since)
      .limit(200),
  ]);
  const deliverOwners = new Set(
    (undelivered ?? []).map((r) => String(r.owner_id))
  );
  const owners = [
    ...new Set(
      [...(pending ?? []), ...(undelivered ?? [])].map((r) => String(r.owner_id))
    ),
  ].slice(0, 20);

  for (const ownerId of owners) {
    try {
      // Deliveries first — fans who already paid shouldn't wait behind scans.
      if (deliverOwners.has(ownerId)) await retryUndeliveredUnlocks(ownerId);
      const session = await tgSessionFor(ownerId).catch(() => null);
      if (!session) continue;
      await chargeReactionUnlocks(ownerId, session);
    } catch {
      // one creator failing shouldn't stop the rest
    }
  }
}

/** Keep scanning until the next cron tick takes over. */
async function scanLoop(): Promise<void> {
  if (loopRunning) return;
  loopRunning = true;
  try {
    const deadline = Date.now() + LOOP_WINDOW_MS;
    while (Date.now() < deadline) {
      const started = Date.now();
      try {
        await scanOnce();
      } catch {
        // keep looping
      }
      const wait = LOOP_STEP_MS - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  } finally {
    loopRunning = false;
  }
}

// One backfill run per warm instance; overlapping crons skip it.
let backfillRunning = false;

/**
 * Pre-upload vault media to Telegram, a couple of items per creator per
 * cron tick. Big videos upload once here, in the background, so sends and
 * unlock deliveries never wait on an upload again. Small batches keep each
 * tick short and stay clear of Telegram's flood limits — a whole vault
 * fills in over successive ticks.
 */
async function backfillMediaCache(): Promise<void> {
  if (backfillRunning) return;
  backfillRunning = true;
  try {
    const { data: accounts } = await supabaseAdmin()
      .from("telegram_accounts")
      .select("owner_id")
      .eq("status", "connected")
      .limit(20);
    for (const account of accounts ?? []) {
      const ownerId = String(account.owner_id);
      try {
        const session = await tgSessionFor(ownerId);
        if (!session) continue;
        await cacheVaultBacklog(ownerId, session, 2);
      } catch {
        // one creator failing shouldn't stop the rest
      }
    }
  } finally {
    backfillRunning = false;
  }
}

/**
 * Background worker for reaction-to-pay: scans every creator's pending PPVs
 * for double-tap reactions, charges saved cards, and retries undelivered
 * media — independent of anyone having the app open.
 *
 * Responds immediately (so short-timeout pingers like cron-job.org never
 * fail), then keeps scanning in the background every few seconds until the
 * next cron tick takes over.
 *
 * Trigger it every minute with a scheduler:
 *   - Vercel Cron (vercel.json) — sends Authorization: Bearer <CRON_SECRET>
 *   - or any external pinger (cron-job.org, UptimeRobot) calling
 *     /api/telegram/reactions/scan?secret=<CRON_SECRET>
 *
 * Requires the CRON_SECRET env var; without it the endpoint stays disabled.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const given =
    auth.startsWith("Bearer ") ? auth.slice(7) : req.nextUrl.searchParams.get("secret") ?? "";
  if (given !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!telegramConfigured()) {
    return NextResponse.json({ error: "Telegram is not configured" }, { status: 503 });
  }

  const alreadyLooping = loopRunning;
  if (!alreadyLooping) after(scanLoop);
  if (!backfillRunning) after(backfillMediaCache);
  return NextResponse.json({ ok: true, looping: !alreadyLooping });
}
