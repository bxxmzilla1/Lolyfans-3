import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { fetchAllRows } from "@/lib/fetchAllRows";

/** Ids per DELETE. Kept small: the ids ride in the URL, which proxies cap. */
const BATCH = 80;
/** Above this many exclusions, stop using a single NOT IN statement. */
const MAX_INLINE_KEEP = 80;

/** Real chat total — the inbox list itself stops at 1000 rows. */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { count } = await supabaseAdmin()
    .from("chats")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);
  return NextResponse.json({ total: count ?? 0 });
}

/**
 * Delete every chat this creator has, minus the ones they chose to keep.
 * Guarded by the admin code, same as deleting a single chat.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const expected = process.env.ADMIN_CODE;
  if (!expected) {
    return NextResponse.json(
      { error: "Admin code is not configured. Set ADMIN_CODE in the environment." },
      { status: 503 }
    );
  }

  const { code, excludeChatIds } = await req.json();
  if (code !== expected) {
    return NextResponse.json({ error: "Invalid admin code" }, { status: 403 });
  }
  const keep = new Set<string>(
    Array.isArray(excludeChatIds)
      ? excludeChatIds.filter((id) => typeof id === "string")
      : []
  );

  const db = supabaseAdmin();
  // Paged: a plain select stops at 1000 rows, which silently spared every
  // chat past the first thousand on big accounts.
  const { data: rows, error: listError } = await fetchAllRows<{
    id: string;
    guest_ip: string | null;
  }>((from, to) =>
    db
      .from("chats")
      .select("id, guest_ip")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: true })
      .range(from, to)
  );
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const doomed = rows.filter((c) => !keep.has(c.id));
  if (doomed.length === 0) return NextResponse.json({ deleted: 0 });

  const keepIds = rows.filter((c) => keep.has(c.id)).map((c) => c.id);

  // One statement whenever possible — thousands of chats in per-id batches
  // can outrun the request timeout.
  if (keepIds.length === 0) {
    const { error } = await db.from("chats").delete().eq("owner_id", ownerId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (keepIds.length <= MAX_INLINE_KEEP) {
    const { error } = await db
      .from("chats")
      .delete()
      .eq("owner_id", ownerId)
      .not("id", "in", `(${keepIds.join(",")})`);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    for (let i = 0; i < doomed.length; i += BATCH) {
      const ids = doomed.slice(i, i + BATCH).map((c) => c.id);
      const { error } = await db
        .from("chats")
        .delete()
        .eq("owner_id", ownerId)
        .in("id", ids);
      if (error) {
        return NextResponse.json(
          { error: error.message, deleted: i },
          { status: 500 }
        );
      }
    }
  }

  // Scrub the deleted fans' IPs so their device can't auto-resume into a chat
  // — but never touch an IP that a kept chat still relies on.
  const keptIps = new Set(
    rows
      .filter((c) => keep.has(c.id))
      .map((c) => c.guest_ip)
      .filter((ip): ip is string => !!ip)
  );
  const ips = [
    ...new Set(doomed.map((c) => c.guest_ip).filter((ip): ip is string => !!ip)),
  ].filter((ip) => !keptIps.has(ip));
  for (let i = 0; i < ips.length; i += BATCH) {
    await db
      .from("chats")
      .update({ guest_ip: null })
      .in("guest_ip", ips.slice(i, i + BATCH));
  }

  return NextResponse.json({ deleted: doomed.length });
}
