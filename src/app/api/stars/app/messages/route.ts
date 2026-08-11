import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { broadcast } from "@/lib/realtime";
import {
  appOrigin,
  botForOwner,
  botCreateStarsInvoiceLink,
  ensureStarsChat,
  parseWebAppUser,
  verifyWebAppInitData,
} from "@/lib/telegramBot";

async function fanFromInit(
  ownerId: string,
  initData: string
): Promise<{
  bot: NonNullable<Awaited<ReturnType<typeof botForOwner>>>;
  user: { id: number; username?: string; first_name?: string; last_name?: string };
  chatId: string;
} | null> {
  const bot = await botForOwner(ownerId);
  if (!bot) return null;
  const verified = verifyWebAppInitData(initData, bot.bot_token);
  if (!verified) return null;
  const user = parseWebAppUser(verified);
  if (!user) return null;
  const chat = await ensureStarsChat({
    ownerId,
    tgUserId: user.id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
  });
  return { bot, user, chatId: chat.id };
}

/** Fan Mini App: list messages (locked media stays locked until paid). */
export async function GET(req: NextRequest) {
  const ownerId = req.nextUrl.searchParams.get("ownerId") || "";
  const initData = req.nextUrl.searchParams.get("initData") || "";
  const fan = await fanFromInit(ownerId, initData);
  if (!fan) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin()
    .from("stars_messages")
    .select("*")
    .eq("chat_id", fan.chatId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Don't leak clear media URL while locked — client shows a lock card.
  const messages = (data ?? []).map((m) => {
    if (m.locked && m.status !== "paid") {
      return {
        ...m,
        media_path: null,
        media_locked: true,
      };
    }
    return { ...m, media_locked: false };
  });

  return NextResponse.json({ chatId: fan.chatId, messages });
}

/** Fan Mini App: send a text message to the creator. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ownerId = String(body.ownerId || "").trim();
  const initData = String(body.initData || "").trim();
  const content = String(body.content || "").trim().slice(0, 4000);
  if (!content) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const fan = await fanFromInit(ownerId, initData);
  if (!fan) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: row, error } = await supabaseAdmin()
    .from("stars_messages")
    .insert({
      chat_id: fan.chatId,
      owner_id: ownerId,
      sender: "fan",
      content,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin()
    .from("stars_chats")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", fan.chatId);

  await broadcast(`stars:${ownerId}`, "new-message", {
    chatId: fan.chatId,
    message: row,
  });
  await broadcast(`stars-chat:${fan.chatId}`, "new-message", { message: row });

  return NextResponse.json({ message: row });
}

/** Fan Mini App: create a Stars invoice link for a locked message. */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ownerId = String(body.ownerId || "").trim();
  const initData = String(body.initData || "").trim();
  const messageId = String(body.messageId || "").trim();

  const fan = await fanFromInit(ownerId, initData);
  if (!fan) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: msg } = await supabaseAdmin()
    .from("stars_messages")
    .select("*")
    .eq("id", messageId)
    .eq("chat_id", fan.chatId)
    .maybeSingle();
  if (!msg?.locked || !msg.unlock_id || !msg.price_stars) {
    return NextResponse.json({ error: "Nothing to unlock" }, { status: 400 });
  }

  const { data: unlock } = await supabaseAdmin()
    .from("stars_unlocks")
    .select("*")
    .eq("id", msg.unlock_id)
    .maybeSingle();
  if (!unlock || unlock.status !== "pending") {
    return NextResponse.json(
      { error: "Already unlocked or unavailable" },
      { status: 400 }
    );
  }

  try {
    const link = await botCreateStarsInvoiceLink({
      token: fan.bot.bot_token,
      unlockId: unlock.id,
      title: `${unlock.price_stars} Stars unlock`,
      description: "Unlock this photo/video",
      stars: unlock.price_stars,
      // Blurred still — the invoice must never show the clear file.
      photoUrl: `${appOrigin()}/api/stars/teaser/${unlock.id}`,
    });
    return NextResponse.json({ invoiceLink: link });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not start payment" },
      { status: 500 }
    );
  }
}
