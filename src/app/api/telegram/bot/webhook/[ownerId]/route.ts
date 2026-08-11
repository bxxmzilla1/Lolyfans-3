import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { broadcast } from "@/lib/realtime";
import {
  botApi,
  botForOwner,
  botSendMedia,
  botSendText,
  ensureStarsChat,
} from "@/lib/telegramBot";

export const runtime = "nodejs";
export const maxDuration = 60;

type TgUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: TgUser;
    chat: { id: number; type: string };
    text?: string;
    successful_payment?: {
      currency: string;
      total_amount: number;
      invoice_payload: string;
      telegram_payment_charge_id: string;
    };
  };
  pre_checkout_query?: {
    id: string;
    from: TgUser;
    currency: string;
    total_amount: number;
    invoice_payload: string;
  };
};

/**
 * Telegram Bot webhook: fan messages, Stars pre-checkout, and successful
 * Stars payments that unlock Mini App PPVs.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ownerId: string }> }
) {
  const { ownerId } = await params;
  const secret = req.nextUrl.searchParams.get("secret") || "";
  const bot = await botForOwner(ownerId);
  if (!bot || !secret || secret !== bot.webhook_secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (!update) return NextResponse.json({ ok: true });

  try {
    if (update.pre_checkout_query) {
      await handlePreCheckout(bot.bot_token, update.pre_checkout_query);
    } else if (update.message?.successful_payment) {
      await handleSuccessfulPayment(
        ownerId,
        bot.bot_token,
        update.message.from!,
        update.message.successful_payment
      );
    } else if (update.message?.from && update.message.chat.type === "private") {
      await handleFanMessage(ownerId, bot.bot_token, update.message);
    }
  } catch (e) {
    console.error("[bot webhook]", e);
  }

  return NextResponse.json({ ok: true });
}

async function handlePreCheckout(
  token: string,
  q: NonNullable<TgUpdate["pre_checkout_query"]>
) {
  const unlockId = q.invoice_payload;
  const { data: unlock } = await supabaseAdmin()
    .from("stars_unlocks")
    .select("id, status, price_stars")
    .eq("id", unlockId)
    .maybeSingle();

  if (!unlock || unlock.status !== "pending") {
    await botApi(token, "answerPreCheckoutQuery", {
      pre_checkout_query_id: q.id,
      ok: false,
      error_message: "This unlock is no longer available.",
    });
    return;
  }
  if (q.currency !== "XTR" || q.total_amount !== unlock.price_stars) {
    await botApi(token, "answerPreCheckoutQuery", {
      pre_checkout_query_id: q.id,
      ok: false,
      error_message: "Price mismatch. Please try again.",
    });
    return;
  }
  await botApi(token, "answerPreCheckoutQuery", {
    pre_checkout_query_id: q.id,
    ok: true,
  });
}

async function handleSuccessfulPayment(
  ownerId: string,
  token: string,
  from: TgUser,
  payment: NonNullable<
    NonNullable<TgUpdate["message"]>["successful_payment"]
  >
) {
  const unlockId = payment.invoice_payload;
  const db = supabaseAdmin();
  const { data: unlock } = await db
    .from("stars_unlocks")
    .select("*")
    .eq("id", unlockId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!unlock || unlock.status === "paid" || unlock.status === "delivered") {
    return;
  }

  await db
    .from("stars_unlocks")
    .update({
      status: "paid",
      telegram_payment_charge_id: payment.telegram_payment_charge_id,
      paid_at: new Date().toISOString(),
    })
    .eq("id", unlockId)
    .eq("status", "pending");

  if (unlock.message_id) {
    await db
      .from("stars_messages")
      .update({ locked: false, status: "paid" })
      .eq("id", unlock.message_id);
  }

  const { data: chat } = await db
    .from("stars_chats")
    .select("tg_user_id")
    .eq("id", unlock.chat_id)
    .maybeSingle();

  const tgUserId = chat?.tg_user_id ?? from.id;
  try {
    await botSendMedia({
      token,
      chatId: Number(tgUserId),
      mediaPath: unlock.media_path,
      mediaType: unlock.media_type === "video" ? "video" : "image",
      caption: "Unlocked — enjoy!",
    });
    await db
      .from("stars_unlocks")
      .update({
        status: "delivered",
        delivered_at: new Date().toISOString(),
      })
      .eq("id", unlockId);
  } catch (e) {
    console.error("[stars deliver]", e);
  }

  await broadcast(`stars:${ownerId}`, "unlock-paid", {
    unlockId,
    chatId: unlock.chat_id,
  });
  await broadcast(`stars-chat:${unlock.chat_id}`, "unlock-paid", {
    unlockId,
    messageId: unlock.message_id,
  });
}

async function handleFanMessage(
  ownerId: string,
  token: string,
  message: NonNullable<TgUpdate["message"]>
) {
  const from = message.from!;
  const text = (message.text || "").trim();

  // /start — welcome + Mini App hint
  if (text.startsWith("/start")) {
    const bot = await botForOwner(ownerId);
    const uname = bot?.bot_username;
    await botSendText(
      token,
      from.id,
      uname
        ? `Welcome! Tap <b>Open chat</b> below the composer, or open the Mini App:\nhttps://t.me/${uname}?startapp=chat\n\nYou can chat here and unlock PPVs with Telegram Stars.`
        : "Welcome! Open the Mini App from the menu to chat and unlock PPVs with Stars."
    );
  }

  if (!text || text.startsWith("/")) {
    // Still ensure the chat exists for /start so creator sees them.
    if (text.startsWith("/start")) {
      await ensureStarsChat({
        ownerId,
        tgUserId: from.id,
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
      });
    }
    return;
  }

  const chat = await ensureStarsChat({
    ownerId,
    tgUserId: from.id,
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
  });

  const { data: row } = await supabaseAdmin()
    .from("stars_messages")
    .insert({
      chat_id: chat.id,
      owner_id: ownerId,
      sender: "fan",
      content: text.slice(0, 4000),
    })
    .select("*")
    .single();

  await supabaseAdmin()
    .from("stars_chats")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", chat.id);

  if (row) {
    await broadcast(`stars:${ownerId}`, "new-message", {
      chatId: chat.id,
      message: row,
    });
    await broadcast(`stars-chat:${chat.id}`, "new-message", { message: row });
  }
}
