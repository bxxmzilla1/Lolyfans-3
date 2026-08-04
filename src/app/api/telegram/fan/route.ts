import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fullCountryName, locationFromIp } from "@/lib/geo";

/**
 * GET: the Lolyfans signup geolocation of the fan behind a Telegram peer.
 *
 * A peer maps to a Lolyfans account through their paid PPVs: paying on the
 * web links the fan's chat (created at signup, with IP + country) to the
 * peer via telegram_unlocks.paid_chat_id. Fans who never paid have no
 * mapping, so location comes back null.
 */
export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const peer = req.nextUrl.searchParams.get("peer")?.trim();
  if (!peer) {
    return NextResponse.json({ error: "peer required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: prior } = await db
    .from("telegram_unlocks")
    .select("paid_chat_id")
    .eq("owner_id", ownerId)
    .eq("tg_peer", peer)
    .eq("status", "paid")
    .not("paid_chat_id", "is", null)
    .order("paid_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const chatId = (prior?.paid_chat_id as string | null) ?? null;
  if (!chatId) return NextResponse.json({ location: null });

  const { data: chat } = await db
    .from("chats")
    .select("guest_ip, guest_country")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ location: null });

  // Precise "City, Country" from the signup IP, falling back to the
  // country code recorded when they joined.
  const location =
    (await locationFromIp((chat.guest_ip as string | null) ?? null)) ??
    fullCountryName((chat.guest_country as string | null) ?? null);
  return NextResponse.json({ location });
}
