import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

const BATCH = 200;

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
    Array.isArray(excludeChatIds) ? excludeChatIds.filter((id) => typeof id === "string") : []
  );

  const db = supabaseAdmin();
  const { data: rows, error: listError } = await db
    .from("chats")
    .select("id, guest_ip")
    .eq("owner_id", ownerId);
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const doomed = (rows ?? []).filter((c) => !keep.has(c.id as string));
  if (doomed.length === 0) return NextResponse.json({ deleted: 0 });

  for (let i = 0; i < doomed.length; i += BATCH) {
    const ids = doomed.slice(i, i + BATCH).map((c) => c.id as string);
    const { error } = await db
      .from("chats")
      .delete()
      .eq("owner_id", ownerId)
      .in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Scrub the deleted fans' IPs so their device can't auto-resume into a chat
  // — but never touch an IP that a kept chat still relies on.
  const keptIps = new Set(
    (rows ?? [])
      .filter((c) => keep.has(c.id as string))
      .map((c) => c.guest_ip as string | null)
      .filter(Boolean) as string[]
  );
  const ips = [
    ...new Set(
      doomed.map((c) => c.guest_ip as string | null).filter((ip): ip is string => !!ip)
    ),
  ].filter((ip) => !keptIps.has(ip));
  for (let i = 0; i < ips.length; i += BATCH) {
    await db
      .from("chats")
      .update({ guest_ip: null })
      .in("guest_ip", ips.slice(i, i + BATCH));
  }

  return NextResponse.json({ deleted: doomed.length });
}
