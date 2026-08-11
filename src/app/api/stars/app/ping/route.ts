import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  botForOwner,
  ensureStarsChat,
  parseWebAppUser,
  verifyWebAppInitData,
} from "@/lib/telegramBot";

/**
 * Fan Mini App heartbeat — marks them as "in app" so creator messages don't
 * trigger a bot unread notification while they're already looking at the chat.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ownerId = String(body.ownerId || "").trim();
  const initData = String(body.initData || "").trim();
  if (!ownerId || !initData) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bot = await botForOwner(ownerId);
  if (!bot) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const verified = verifyWebAppInitData(initData, bot.bot_token);
  if (!verified) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = parseWebAppUser(verified);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const chat = await ensureStarsChat({
    ownerId,
    tgUserId: user.id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
  });

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin()
    .from("stars_chats")
    .update({ fan_last_seen_at: now })
    .eq("id", chat.id);

  // Column missing before migration — still ok, notifications will always ping.
  if (error && !/fan_last_seen_at|column/i.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
