import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { broadcast } from "@/lib/realtime";
import { paidSubFromMetadata } from "@/lib/paidSub";

/** Max ids per .in() filter — they travel in the PostgREST request URL. */
const BATCH = 200;
/** Concurrent realtime broadcasts per wave. */
const BROADCAST_BATCH = 50;

/**
 * Mass PaidSub:
 *   action "offer"  — push the blocking popup into every current card-less,
 *                     unpaid chat (one-shot snapshot; new fans not included)
 *   action "remove" — clear the offer from every chat that still has it
 *                     pending (popup disappears; paid fans are untouched)
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action === "remove" ? "remove" : "offer";

  const db = supabaseAdmin();
  const { data: ownerUser } = await db.auth.admin.getUserById(ownerId);
  const cfg = paidSubFromMetadata(ownerUser?.user?.user_metadata ?? {});

  if (action === "offer") {
    if (!cfg.enabled) {
      return NextResponse.json(
        { error: "Turn on PaidSub in Settings first" },
        { status: 400 }
      );
    }

    const { data: rows, error } = await db
      .from("chats")
      .select("id")
      .eq("owner_id", ownerId)
      .is("stripe_payment_method_id", null)
      .is("paidsub_paid_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const targetIds = (rows ?? []).map((c) => c.id as string);
    if (targetIds.length === 0) {
      return NextResponse.json({ ok: true, applied: 0 });
    }

    const now = new Date().toISOString();
    for (let i = 0; i < targetIds.length; i += BATCH) {
      const { error: updErr } = await db
        .from("chats")
        .update({ paidsub_offer_at: now })
        .in("id", targetIds.slice(i, i + BATCH));
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    after(async () => {
      const jobs = targetIds.map(
        (id) => () =>
          broadcast(`chat:${id}`, "paidsub", {
            offered: true,
            paid: false,
            tokens: cfg.tokens,
            priceCents: cfg.priceCents,
            originalCents: cfg.originalCents,
          })
      );
      for (let i = 0; i < jobs.length; i += BROADCAST_BATCH) {
        await Promise.all(jobs.slice(i, i + BROADCAST_BATCH).map((run) => run()));
      }
    });

    return NextResponse.json({ ok: true, applied: targetIds.length });
  }

  // remove — take the popup down for every chat that still has a pending offer.
  const { data: rows, error } = await db
    .from("chats")
    .select("id")
    .eq("owner_id", ownerId)
    .not("paidsub_offer_at", "is", null)
    .is("paidsub_paid_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const targetIds = (rows ?? []).map((c) => c.id as string);
  if (targetIds.length === 0) {
    return NextResponse.json({ ok: true, removed: 0 });
  }

  for (let i = 0; i < targetIds.length; i += BATCH) {
    const { error: updErr } = await db
      .from("chats")
      .update({ paidsub_offer_at: null })
      .in("id", targetIds.slice(i, i + BATCH));
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  after(async () => {
    const jobs = targetIds.map(
      (id) => () =>
        broadcast(`chat:${id}`, "paidsub", { offered: false, paid: false })
    );
    for (let i = 0; i < jobs.length; i += BROADCAST_BATCH) {
      await Promise.all(jobs.slice(i, i + BROADCAST_BATCH).map((run) => run()));
    }
  });

  return NextResponse.json({ ok: true, removed: targetIds.length });
}
