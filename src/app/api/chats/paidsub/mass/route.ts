import { NextResponse } from "next/server";
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
 * Mass-apply PaidSub: push the blocking offer popup into every CURRENT chat
 * that has no registered card (and hasn't already paid). Deliberately a
 * one-shot snapshot — fans who join later are not included until the creator
 * applies again (or per chat from the composer).
 */
export async function POST() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const { data: ownerUser } = await db.auth.admin.getUserById(ownerId);
  const cfg = paidSubFromMetadata(ownerUser?.user?.user_metadata ?? {});
  if (!cfg.enabled) {
    return NextResponse.json(
      { error: "Turn on PaidSub in Settings first" },
      { status: 400 }
    );
  }

  // Snapshot of current card-less, unpaid chats. Includes ones already
  // offered — re-applying just refreshes their offer timestamp.
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

  // Pop the offer up live for fans currently in their chat — after the
  // response, in bounded waves (thousands at once would stall the request).
  after(async () => {
    const jobs = targetIds.map(
      (id) => () =>
        broadcast(`chat:${id}`, "paidsub", {
          offered: true,
          paid: false,
          priceCents: cfg.priceCents,
        })
    );
    for (let i = 0; i < jobs.length; i += BROADCAST_BATCH) {
      await Promise.all(jobs.slice(i, i + BROADCAST_BATCH).map((run) => run()));
    }
  });

  return NextResponse.json({ ok: true, applied: targetIds.length });
}
