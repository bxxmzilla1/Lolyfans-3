import { NextRequest, NextResponse } from "next/server";
import { getGuestChatId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  activeCpmSession,
  chargeCpmMinutes,
  endCpmSession,
  minutesOwed,
} from "@/lib/cpm";

/**
 * Heartbeat while a Chat-per-minute fan is in the chat.
 *  - Always bumps last_active_at.
 *  - Every ~30 minutes of wall time since session start (or since the last
 *    bill), charges any unpaid minutes on the saved card.
 *  - A declined charge ends the session.
 *
 * Body: `{ settle?: boolean }` — when true (30-min timer / hang-up), force a
 * bill for whatever minutes are owed right now.
 */
export async function POST(req: NextRequest) {
  const chatId = await getGuestChatId();
  if (!chatId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id, cpm")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat?.cpm) {
    return NextResponse.json({ error: "Not a chat-per-minute chat" }, { status: 400 });
  }

  const session = await activeCpmSession(chatId);
  if (!session) {
    return NextResponse.json({ ok: true, active: false });
  }

  await db
    .from("cpm_sessions")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", session.id);

  const body = await req.json().catch(() => ({}));
  const settle = !!body.settle;

  // Bill when asked (30-min timer / close) or whenever 30+ unpaid minutes piled up.
  const owed = minutesOwed(session);
  const shouldBill = settle || owed >= 30;
  if (shouldBill && owed > 0) {
    if (!(await chargeCpmMinutes(session, owed))) {
      await endCpmSession(session);
      return NextResponse.json(
        { error: "Your card was declined — the chat session has ended.", ended: true },
        { status: 402 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    active: true,
    minutesCharged: session.minutes_charged,
  });
}
