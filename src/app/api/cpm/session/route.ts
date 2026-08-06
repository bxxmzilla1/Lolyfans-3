import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { activeCpmSession, endStaleCpmSessions } from "@/lib/cpm";
import { cpmSessionLive } from "@/lib/cpmShared";

/**
 * Creator: live Chat-per-minute session for one fan — used by the chat
 * header to show Active + session earnings.
 */
export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chatId = (req.nextUrl.searchParams.get("chatId") || "").trim();
  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id, owner_id, cpm")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat || chat.owner_id !== ownerId || !chat.cpm) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  // Opportunistically settle crashed tabs so the badge flips to idle.
  await endStaleCpmSessions(ownerId);

  const session = await activeCpmSession(chatId);
  if (!session) {
    return NextResponse.json({ session: null });
  }

  const live = cpmSessionLive(session.last_active_at);
  return NextResponse.json({
    session: {
      id: session.id,
      startedAt: session.started_at,
      lastActiveAt: session.last_active_at,
      minutesCharged: session.minutes_charged,
      live,
    },
  });
}
