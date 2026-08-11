import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { broadcast } from "@/lib/realtime";
import {
  botForOwner,
  botSendMedia,
  notifyUnreadIfAway,
} from "@/lib/telegramBot";

/** Creator or fan (via initData handled elsewhere): list messages for a stars chat. */
export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }

  // Creator path
  if (ownerId) {
    const { data: chat } = await supabaseAdmin()
      .from("stars_chats")
      .select("id, owner_id")
      .eq("id", chatId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await supabaseAdmin()
      .from("stars_messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ messages: data ?? [] });
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Creator: send text or Stars-priced PPV into a Mini App chat. */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bot = await botForOwner(ownerId);
  if (!bot) {
    return NextResponse.json(
      { error: "Connect a Telegram bot in Settings → Stars Mini App first" },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || "").trim();
  const content = String(body.content || "").trim().slice(0, 4000);
  const mediaPath = String(body.mediaPath || "").trim();
  const mediaType = body.mediaType === "video" ? "video" : "image";
  const priceStars = Math.max(0, Math.round(Number(body.priceStars) || 0));

  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }

  const { data: chat } = await supabaseAdmin()
    .from("stars_chats")
    .select("*")
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const db = supabaseAdmin();

  // Text-only message
  if (!mediaPath) {
    if (!content) {
      return NextResponse.json({ error: "Message is empty" }, { status: 400 });
    }
    const { data: row, error } = await db
      .from("stars_messages")
      .insert({
        chat_id: chatId,
        owner_id: ownerId,
        sender: "owner",
        content,
      })
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await db
      .from("stars_chats")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", chatId);

    // Fan left the Mini App → bot push: "{creator} sent you a message ❤️".
    // If they're still in the app, the in-app poll shows the message — no ping.
    try {
      await notifyUnreadIfAway({
        token: bot.bot_token,
        ownerId,
        chatId,
        tgUserId: Number(chat.tg_user_id),
        botUsername: bot.bot_username,
        kind: "message",
      });
    } catch (e) {
      console.error("[stars unread notify]", e);
    }

    await broadcast(`stars-chat:${chatId}`, "new-message", { message: row });
    return NextResponse.json({ message: row });
  }

  // PPV or free media
  if (priceStars > 0 && priceStars < 1) {
    return NextResponse.json({ error: "Minimum is 1 Star" }, { status: 400 });
  }

  let unlockId: string | null = null;
  if (priceStars > 0) {
    const { data: unlock, error: uErr } = await db
      .from("stars_unlocks")
      .insert({
        owner_id: ownerId,
        chat_id: chatId,
        media_path: mediaPath,
        media_type: mediaType,
        price_stars: priceStars,
        status: "pending",
      })
      .select("id")
      .single();
    if (uErr || !unlock) {
      return NextResponse.json(
        { error: uErr?.message || "Could not create unlock" },
        { status: 500 }
      );
    }
    unlockId = unlock.id as string;
  }

  const { data: row, error } = await db
    .from("stars_messages")
    .insert({
      chat_id: chatId,
      owner_id: ownerId,
      sender: "owner",
      content: content || null,
      media_path: mediaPath,
      media_type: mediaType,
      locked: priceStars > 0,
      price_stars: priceStars,
      unlock_id: unlockId,
      status: priceStars > 0 ? "pending_pay" : "visible",
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (unlockId) {
    await db
      .from("stars_unlocks")
      .update({ message_id: row.id })
      .eq("id", unlockId);
  }

  await db
    .from("stars_chats")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", chatId);

  // Away from Mini App → PPVs get the teaser wording, free media the plain one.
  try {
    await notifyUnreadIfAway({
      token: bot.bot_token,
      ownerId,
      chatId,
      tgUserId: Number(chat.tg_user_id),
      botUsername: bot.bot_username,
      kind: priceStars > 0 ? "ppv" : "message",
    });
  } catch (e) {
    console.error("[stars unread notify]", e);
  }

  // PPVs stay in the Mini App only (fan pays via the locked bubble there) —
  // no invoice in the bot chat. Free media still goes out through the bot.
  if (priceStars === 0) {
    try {
      await botSendMedia({
        token: bot.bot_token,
        chatId: Number(chat.tg_user_id),
        mediaPath,
        mediaType,
        caption: content || undefined,
      });
    } catch (e) {
      console.error("[stars send media]", e);
    }
  }

  await broadcast(`stars-chat:${chatId}`, "new-message", { message: row });
  return NextResponse.json({ message: row });
}
