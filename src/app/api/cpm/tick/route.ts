import { NextRequest, NextResponse } from "next/server";
import { getGuestChatId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  activeCpmSession,
  chargeCpmMinutes,
  CPM_BILL_EVERY_MIN,
  endCpmSession,
  minutesOwed,
} from "@/lib/cpm";

/**
 * Heartbeat while a Chat-per-minute fan is in the chat.
 *  - Always bumps last_active_at.
 *  - Every ~10 minutes of wall time since session start (or since the last
 *    bill), charges the accrued minutes in one lump on the saved card —
 *    never minute-by-minute, so banks don't block the card.
 *  - A declined charge ends the session.
 *
 * Body: `{ settle?: boolean }` — when true (10-min timer / close), force a
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

  const nowIso = new Date().toISOString();
  await db
    .from("cpm_sessions")
    .update({ last_active_at: nowIso })
    .eq("id", session.id);
  // Keep local copy in sync — minutesOwed bills only through last_active_at.
  session.last_active_at = nowIso;

  const body = await req.json().catch(() => ({}));
  const settle = !!body.settle;

  // Bill when asked (10-min timer) or whenever 10+ unpaid active minutes piled up.
  const owed = minutesOwed(session);
  const shouldBill = settle || owed >= CPM_BILL_EVERY_MIN;
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
