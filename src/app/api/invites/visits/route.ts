import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Geo-located visitors of one invite link — feeds the Visitors popup. */
export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inviteId = req.nextUrl.searchParams.get("id") || "";
  if (!inviteId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: invite } = await db
    .from("invites")
    .select("id")
    .eq("id", inviteId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!invite) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await db
    .from("invite_visits")
    .select("ip, country, city, region, org, created_at, last_seen_at")
    .eq("invite_id", inviteId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ visits: data ?? [] });
}
