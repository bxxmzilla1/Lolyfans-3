import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  botForOwner,
  ensureStarsChat,
  parseWebAppUser,
  verifyWebAppInitData,
} from "@/lib/telegramBot";

/**
 * Fan Mini App: verify Telegram initData and open/create their Stars chat
 * with this creator.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ownerId = String(body.ownerId || "").trim();
  const initData = String(body.initData || "").trim();
  if (!ownerId || !initData) {
    return NextResponse.json(
      { error: "ownerId and initData required" },
      { status: 400 }
    );
  }

  const bot = await botForOwner(ownerId);
  if (!bot) {
    return NextResponse.json(
      { error: "This creator has not connected a Stars bot yet" },
      { status: 404 }
    );
  }

  const verified = verifyWebAppInitData(initData, bot.bot_token);
  if (!verified) {
    return NextResponse.json(
      { error: "Open this Mini App from Telegram" },
      { status: 401 }
    );
  }
  const user = parseWebAppUser(verified);
  if (!user) {
    return NextResponse.json({ error: "Invalid user" }, { status: 401 });
  }

  const chat = await ensureStarsChat({
    ownerId,
    tgUserId: user.id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
  });

  const { data: ownerUser } = await supabaseAdmin().auth.admin.getUserById(
    ownerId
  );
  const meta = (ownerUser?.user?.user_metadata ?? {}) as {
    display_name?: string;
    avatar_path?: string;
  };

  return NextResponse.json({
    chatId: chat.id,
    tgUserId: user.id,
    ownerName: meta.display_name || "Creator",
    ownerAvatar: meta.avatar_path || null,
    botUsername: bot.bot_username,
  });
}
