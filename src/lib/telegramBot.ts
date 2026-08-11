import "server-only";
import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mediaUrl } from "@/lib/utils";

/** Private code the creator must send to the bot before it makes PPVs. */
export const BOT_ACTIVATION_CODE = "242124";

export type TelegramBotRow = {
  owner_id: string;
  bot_token: string;
  bot_username: string | null;
  bot_id: number | null;
  webhook_secret: string;
};

export function appOrigin(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_ORIGIN || "").trim();
  if (raw) {
    try {
      return new URL(raw.includes("://") ? raw : `https://${raw}`).origin;
    } catch {
      /* fall through */
    }
  }
  return "https://www.lolyfans.com";
}

export async function botForOwner(
  ownerId: string
): Promise<TelegramBotRow | null> {
  const { data } = await supabaseAdmin()
    .from("telegram_bots")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();
  return (data as TelegramBotRow | null) ?? null;
}

export async function botByToken(
  token: string
): Promise<TelegramBotRow | null> {
  const { data } = await supabaseAdmin()
    .from("telegram_bots")
    .select("*")
    .eq("bot_token", token)
    .maybeSingle();
  return (data as TelegramBotRow | null) ?? null;
}

export async function botApi<T = unknown>(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: T;
  };
  if (!data.ok) {
    throw new Error(data.description || `Telegram Bot API ${method} failed`);
  }
  return data.result as T;
}

export function newWebhookSecret(): string {
  return randomBytes(24).toString("hex");
}

export async function validateBotToken(token: string): Promise<{
  id: number;
  username: string;
}> {
  const me = await botApi<{ id: number; username: string }>(token, "getMe");
  if (!me?.username) throw new Error("That doesn't look like a bot token");
  return { id: me.id, username: me.username };
}

export async function setBotWebhook(
  token: string,
  ownerId: string,
  secret: string
): Promise<void> {
  const url = `${appOrigin()}/api/telegram/bot/webhook/${ownerId}?secret=${encodeURIComponent(secret)}`;
  await botApi(token, "setWebhook", {
    url,
    allowed_updates: ["message", "pre_checkout_query"],
    drop_pending_updates: false,
  });
  // The Mini App menu button is gone — reset to the default commands menu.
  await botApi(token, "setChatMenuButton", {
    menu_button: { type: "default" },
  }).catch(() => {});
}

export async function botSendText(
  token: string,
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<void> {
  await botApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Resolve a Telegram file id to its download URL. Bots can only download
 * files up to ~20MB — callers must treat failures as "no local copy".
 */
export async function botGetFileUrl(
  token: string,
  fileId: string
): Promise<string> {
  const file = await botApi<{ file_path?: string }>(token, "getFile", {
    file_id: fileId,
  });
  if (!file?.file_path) throw new Error("Telegram did not return a file path");
  return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
}

/** Resend a photo/video by Telegram file id — full quality, no size limit. */
export async function botSendByFileId(opts: {
  token: string;
  chatId: number;
  fileId: string;
  mediaType: "image" | "video";
  caption?: string;
}): Promise<void> {
  if (opts.mediaType === "video") {
    await botApi(opts.token, "sendVideo", {
      chat_id: opts.chatId,
      video: opts.fileId,
      caption: opts.caption || undefined,
    });
  } else {
    await botApi(opts.token, "sendPhoto", {
      chat_id: opts.chatId,
      photo: opts.fileId,
      caption: opts.caption || undefined,
    });
  }
}

export async function botSendMedia(opts: {
  token: string;
  chatId: number;
  mediaPath: string;
  mediaType: "image" | "video";
  caption?: string;
}): Promise<void> {
  const url = mediaUrl(opts.mediaPath);
  if (opts.mediaType === "video") {
    await botApi(opts.token, "sendVideo", {
      chat_id: opts.chatId,
      video: url,
      caption: opts.caption || undefined,
    });
  } else {
    await botApi(opts.token, "sendPhoto", {
      chat_id: opts.chatId,
      photo: url,
      caption: opts.caption || undefined,
    });
  }
}

/**
 * Stars payment link for a PPV unlock (currency XTR). Anyone who opens the
 * link gets the payment sheet — it works from forwarded messages too, which
 * is how creators sell: blurred media bubble + this link in the caption.
 */
export async function botCreateStarsInvoiceLink(opts: {
  token: string;
  unlockId: string;
  title: string;
  description: string;
  stars: number;
}): Promise<string> {
  return botApi<string>(opts.token, "createInvoiceLink", {
    title: opts.title.slice(0, 32),
    description: opts.description.slice(0, 255),
    payload: opts.unlockId.slice(0, 128),
    currency: "XTR",
    prices: [{ label: opts.title.slice(0, 32), amount: opts.stars }],
  });
}

