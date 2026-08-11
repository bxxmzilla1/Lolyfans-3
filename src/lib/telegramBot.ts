import "server-only";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mediaUrl } from "@/lib/utils";

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
    allowed_updates: [
      "message",
      "pre_checkout_query",
      "successful_payment",
      "callback_query",
    ],
    drop_pending_updates: false,
  });
  // Menu button opens the Mini App for fans.
  await botApi(token, "setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "Open chat",
      web_app: { url: `${appOrigin()}/tg-app/${ownerId}` },
    },
  }).catch(() => {});
}

/** Verify Telegram WebApp initData (HMAC-SHA-256 with bot token). */
export function verifyWebAppInitData(
  initData: string,
  botToken: string
): Record<string, string> | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");
    const entries = [...params.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const dataCheck = entries.map(([k, v]) => `${k}=${v}`).join("\n");
    const secretKey = createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();
    const computed = createHmac("sha256", secretKey)
      .update(dataCheck)
      .digest("hex");
    const a = Buffer.from(computed, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const authDate = Number(params.get("auth_date") || 0);
    // Reject initData older than 24h.
    if (!authDate || Date.now() / 1000 - authDate > 86_400) return null;

    const out: Record<string, string> = {};
    for (const [k, v] of params.entries()) out[k] = v;
    return out;
  } catch {
    return null;
  }
}

export function parseWebAppUser(initData: Record<string, string>): {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
} | null {
  try {
    const user = JSON.parse(initData.user || "null") as {
      id: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    } | null;
    if (!user?.id) return null;
    return user;
  } catch {
    return null;
  }
}

export async function ensureStarsChat(opts: {
  ownerId: string;
  tgUserId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): Promise<{ id: string }> {
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("stars_chats")
    .select("id")
    .eq("owner_id", opts.ownerId)
    .eq("tg_user_id", opts.tgUserId)
    .maybeSingle();
  if (existing) {
    await db
      .from("stars_chats")
      .update({
        username: opts.username ?? undefined,
        first_name: opts.firstName ?? undefined,
        last_name: opts.lastName ?? undefined,
        last_message_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return { id: existing.id as string };
  }
  const { data, error } = await db
    .from("stars_chats")
    .insert({
      owner_id: opts.ownerId,
      tg_user_id: opts.tgUserId,
      username: opts.username ?? null,
      first_name: opts.firstName ?? null,
      last_name: opts.lastName ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message || "Could not create chat");
  return { id: data.id as string };
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

/** How long after the last Mini App heartbeat we still treat the fan as "in app". */
export const FAN_IN_APP_MS = 90_000;

export function fanIsInMiniApp(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return false;
  const t = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < FAN_IN_APP_MS;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * If the fan left the Mini App, ping them in the bot chat that they have an
 * unread message from the creator. Skips when a recent heartbeat says they're
 * still inside the Mini App.
 */
export async function notifyUnreadIfAway(opts: {
  token: string;
  ownerId: string;
  chatId: string;
  tgUserId: number;
  botUsername?: string | null;
}): Promise<boolean> {
  const db = supabaseAdmin();
  let lastSeen: string | null = null;
  {
    const { data: chat, error } = await db
      .from("stars_chats")
      .select("fan_last_seen_at")
      .eq("id", opts.chatId)
      .maybeSingle();
    // Column missing before migration → always notify (safe default).
    if (!error) lastSeen = (chat?.fan_last_seen_at as string | null) ?? null;
  }

  if (fanIsInMiniApp(lastSeen)) {
    return false;
  }

  const { data: ownerUser } = await db.auth.admin.getUserById(opts.ownerId);
  const meta = (ownerUser?.user?.user_metadata ?? {}) as {
    display_name?: string;
  };
  const name = (meta.display_name || "the creator").trim() || "the creator";

  const miniAppUrl = `${appOrigin()}/tg-app/${opts.ownerId}`;
  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: "Open chat",
          web_app: { url: miniAppUrl },
        },
      ],
    ],
  };

  await botSendText(
    opts.token,
    opts.tgUserId,
    `💬 You have an unread message from <b>${escHtml(name)}</b>.\nTap below to open the chat.`,
    replyMarkup
  );
  return true;
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

/** Stars invoice for a PPV unlock (currency XTR). */
export async function botSendStarsInvoice(opts: {
  token: string;
  chatId: number;
  unlockId: string;
  title: string;
  description: string;
  stars: number;
  photoUrl?: string;
}): Promise<void> {
  await botApi(opts.token, "sendInvoice", {
    chat_id: opts.chatId,
    title: opts.title.slice(0, 32),
    description: opts.description.slice(0, 255),
    payload: opts.unlockId.slice(0, 128),
    currency: "XTR",
    prices: [{ label: opts.title.slice(0, 32), amount: opts.stars }],
    ...(opts.photoUrl ? { photo_url: opts.photoUrl } : {}),
  });
}

export async function botCreateStarsInvoiceLink(opts: {
  token: string;
  unlockId: string;
  title: string;
  description: string;
  stars: number;
  photoUrl?: string;
}): Promise<string> {
  return botApi<string>(opts.token, "createInvoiceLink", {
    title: opts.title.slice(0, 32),
    description: opts.description.slice(0, 255),
    payload: opts.unlockId.slice(0, 128),
    currency: "XTR",
    prices: [{ label: opts.title.slice(0, 32), amount: opts.stars }],
    ...(opts.photoUrl ? { photo_url: opts.photoUrl } : {}),
  });
}
