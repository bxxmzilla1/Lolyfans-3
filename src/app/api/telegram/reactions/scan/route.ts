import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { tgSessionFor, telegramConfigured } from "@/lib/telegram";
import {
  chargeReactionUnlocks,
  retryUndeliveredUnlocks,
} from "@/lib/telegramUnlock";

export const dynamic = "force-dynamic";
// Video deliveries can take minutes — give the worker the full window.
export const maxDuration = 300;

/**
 * Background worker for reaction-to-pay: scans every creator's pending PPVs
 * for double-tap reactions and charges saved cards, independent of anyone
 * having the app open.
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
  const owners = [
    ...new Set(
      [...(pending ?? []), ...(undelivered ?? [])].map((r) => String(r.owner_id))
    ),
  ].slice(0, 20);

  let scanned = 0;
  for (const ownerId of owners) {
    try {
      // Deliveries first — fans who already paid shouldn't wait behind scans.
      await retryUndeliveredUnlocks(ownerId);
      const session = await tgSessionFor(ownerId).catch(() => null);
      if (!session) continue;
      await chargeReactionUnlocks(ownerId, session);
      scanned++;
    } catch {
      // one creator failing shouldn't stop the rest
    }
  }

  return NextResponse.json({ ok: true, owners: owners.length, scanned });
}
