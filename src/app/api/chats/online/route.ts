import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

export const dynamic = "force-dynamic";

/** A fan counts as online while their heartbeat (every 10s) is this fresh. */
const ONLINE_WINDOW_MS = 25_000;

/**
 * Which of this creator's fans are online right now, by heartbeat. Polled
 * every second by the inbox as a self-healing complement to the realtime
 * presence channel, so the green dots never stick when a socket drops.
 */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  const { data, error } = await supabaseAdmin()
    .from("chats")
    .select("id")
    .eq("owner_id", ownerId)
    .gt("guest_last_seen_at", since);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { ids: (data ?? []).map((c) => c.id as string) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
