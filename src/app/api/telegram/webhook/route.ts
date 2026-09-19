import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import {
  ADMIN_NOTIFY_CODE,
  addAdminChat,
  isAdminChat,
  removeAdminChat,
  sendTelegram,
  telegramCall,
  telegramConfigured,
} from "@/lib/adminTelegram";

export const dynamic = "force-dynamic";

type TgUpdate = {
  message?: {
    chat: { id: number; type: string };
    text?: string;
    from?: { first_name?: string };
  };
};

const HELP =
  "Commands:\n" +
  "/status — am I receiving notifications?\n" +
  "/stop — stop notifications\n\n" +
  "Send the admin code again any time to turn them back on.";

/**
 * Telegram calls this for every message sent to the bot.
 * Entering the admin code enrols the chat for platform-wide notifications
 * (every card verification, for every creator).
 */
export async function POST(req: NextRequest) {
  if (!telegramConfigured()) return NextResponse.json({ ok: true });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  const msg = update?.message;
  const text = msg?.text?.trim();
  // Always 200 so Telegram doesn't retry.
  if (!msg || !text) return NextResponse.json({ ok: true });

  const chatId = msg.chat.id;
  const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@.*$/, "");

  if (cmd === "/start" || cmd === "/help") {
    const enrolled = await isAdminChat(chatId);
    await sendTelegram(
      chatId,
      enrolled
        ? `✅ You're receiving Lolyfans admin notifications.\n\n${HELP}`
        : "👋 <b>Lolyfans admin bot</b>\n\nSend the admin code to get notified whenever a fan verifies a card, and which creator they subscribed to."
    );
    return NextResponse.json({ ok: true });
  }

  if (cmd === "/stop") {
    const removed = await removeAdminChat(chatId);
    await sendTelegram(
      chatId,
      removed
        ? "🔕 Notifications off. Send the admin code to turn them back on."
        : "You weren't receiving notifications."
    );
    return NextResponse.json({ ok: true });
  }

  if (cmd === "/status") {
    const enrolled = await isAdminChat(chatId);
    await sendTelegram(
      chatId,
      enrolled
        ? "✅ Notifications are ON for all creators."
        : "🔕 Notifications are OFF. Send the admin code to turn them on."
    );
    return NextResponse.json({ ok: true });
  }

  if (text === ADMIN_NOTIFY_CODE) {
    const added = await addAdminChat(chatId);
    await sendTelegram(
      chatId,
      added
        ? "✅ <b>Admin access granted.</b>\n\nYou'll now be notified about every card verification on Lolyfans — for all creators — including when a verified fan subscribes to another creator.\n\n" +
            HELP
        : `✅ You're already receiving notifications.\n\n${HELP}`
    );
    return NextResponse.json({ ok: true });
  }

  if (await isAdminChat(chatId)) {
    await sendTelegram(chatId, HELP);
  } else {
    await sendTelegram(chatId, "❌ Wrong code. Send the admin code to get notifications.");
  }
  return NextResponse.json({ ok: true });
}

/**
 * One-time setup: open this URL in a browser while logged in as a creator
 * and it registers the webhook with Telegram for this deployment.
 */
export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!telegramConfigured()) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN is not set" }, { status: 503 });
  }

  const origin = `https://${req.headers.get("x-forwarded-host") || req.headers.get("host")}`;
  const url = `${origin}/api/telegram/webhook`;
  const res = await telegramCall("setWebhook", {
    url,
    allowed_updates: ["message"],
    drop_pending_updates: true,
    ...(process.env.TELEGRAM_WEBHOOK_SECRET
      ? { secret_token: process.env.TELEGRAM_WEBHOOK_SECRET }
      : {}),
  });
  const me = await telegramCall<{ username?: string }>("getMe", {});
  return NextResponse.json({
    ok: res.ok,
    webhook: url,
    bot: me.result?.username ? `@${me.result.username}` : null,
    telegram: res.description ?? "ok",
  });
}
