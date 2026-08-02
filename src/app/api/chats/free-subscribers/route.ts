import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { ACTIVE_SUB_STATUSES } from "@/lib/subscriptionAccess";
import { fetchAllRows } from "@/lib/fetchAllRows";

/** Chat ids following this creator WITHOUT an active/trialing paid sub. */
async function freeFollowerChatIds(ownerId: string): Promise<string[]> {
  const db = supabaseAdmin();
  const [followRows, subRows] = await Promise.all([
    fetchAllRows((from, to) =>
      db
        .from("follows")
        .select("chat_id")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      db
        .from("subscriptions")
        .select("chat_id, status")
        .eq("owner_id", ownerId)
        .in("status", ACTIVE_SUB_STATUSES)
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
  ]);
  const paid = new Set((subRows.data ?? []).map((s) => s.chat_id as string));
  return (followRows.data ?? [])
    .map((f) => f.chat_id as string)
    .filter((id) => !paid.has(id));
}

/** How many fans subscribed to the profile for free (no paid subscription). */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ids = await freeFollowerChatIds(ownerId);
  return NextResponse.json({ count: ids.length });
}

/** Mass-unsubscribe: remove every free follower (paid subscribers stay). */
export async function DELETE() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ids = await freeFollowerChatIds(ownerId);
  if (ids.length === 0) return NextResponse.json({ removed: 0 });

  // Delete in batches so huge audiences never hit query-size limits.
  const db = supabaseAdmin();
  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    const { error } = await db
      .from("follows")
      .delete()
      .eq("owner_id", ownerId)
      .in("chat_id", ids.slice(i, i + BATCH));
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  return NextResponse.json({ removed: ids.length });
}
