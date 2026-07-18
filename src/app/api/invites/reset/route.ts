import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

/**
 * Reset the tracking stats of every invite link the owner has: clicks go back
 * to zero (the unique-IP visit rows are deleted, so returning visitors count
 * again) and subscribers go back to zero (chats are detached from their invite
 * link — the conversations themselves are untouched).
 */
export async function POST() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const { data: invites, error } = await db
    .from("invites")
    .select("id")
    .eq("owner_id", ownerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (invites ?? []).map((i) => i.id);
  if (ids.length) {
    const [visits, chats, uses] = await Promise.all([
      db.from("invite_visits").delete().in("invite_id", ids),
      db
        .from("chats")
        .update({ invite_id: null })
        .eq("owner_id", ownerId)
        .not("invite_id", "is", null),
      db.from("invites").update({ uses: 0 }).in("id", ids),
    ]);
    const failed = visits.error || chats.error || uses.error;
    if (failed) return NextResponse.json({ error: failed.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
