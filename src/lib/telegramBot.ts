import "server-only";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
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
  // Menu button opens the creator's vault Mini App (make PPVs from there).
  await botApi(token, "setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "Vault",
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

/** Default caption-link text — "{price}" becomes the Stars amount. */
export const DEFAULT_PPV_LINK_TEXT = "⭐ Unlock for {price} Stars";

const PPV_LINK_TEXT_KEY = (ownerId: string) => `ppv_link_text:${ownerId}`;

/** The creator's saved pay-link text (or the default). */
export async function getPpvLinkText(ownerId: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin()
      .from("site_settings")
      .select("value")
      .eq("key", PPV_LINK_TEXT_KEY(ownerId))
      .maybeSingle();
    const text = (data?.value || "").trim();
    if (text) return text;
  } catch {
    // site_settings missing — fall through to the default.
  }
  return DEFAULT_PPV_LINK_TEXT;
}

export async function savePpvLinkText(
  ownerId: string,
  raw: string
): Promise<void> {
  const text = raw.trim().slice(0, 120);
  if (!text) return;
  await supabaseAdmin()
    .from("site_settings")
    .upsert(
      {
        key: PPV_LINK_TEXT_KEY(ownerId),
        value: text,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
}

/**
 * The forwardable PPV bubble: full-size blurred teaser photo whose caption
 * is a bold tappable Stars pay link (captions + links survive forwarding).
 * Falls back to a link-only text message when there's no teaser copy.
 */
export async function botSendPpvBubble(opts: {
  token: string;
  chatId: number;
  unlockId: string;
  mediaType: "image" | "video";
  mediaPath: string | null;
  caption: string | null;
  stars: number;
  /** Custom pay-link text; "{price}" is replaced with the Stars amount. */
  linkText?: string | null;
}): Promise<void> {
  const kind = opts.mediaType === "video" ? "video" : "photo";
  // Payment sheet texts only — the chat bubble itself shows no invoice UI.
  const payLink = await botCreateStarsInvoiceLink({
    token: opts.token,
    unlockId: opts.unlockId,
    title: `Unlock this ${kind}`,
    description: opts.caption || `${opts.stars} Stars`,
    stars: opts.stars,
  });

  const template = (opts.linkText || "").trim() || DEFAULT_PPV_LINK_TEXT;
  const label = escHtml(template).replaceAll("{price}", String(opts.stars));
  const linkCaption = `<a href="${payLink}"><b>${label}</b></a>`;

  if (opts.mediaPath) {
    await botApi(opts.token, "sendPhoto", {
      chat_id: opts.chatId,
      photo: `${appOrigin()}/api/stars/teaser/${opts.unlockId}`,
      caption: opts.caption
        ? `${escHtml(opts.caption)}\n${linkCaption}`
        : linkCaption,
      parse_mode: "HTML",
    });
  } else {
    await botSendText(opts.token, opts.chatId, linkCaption);
  }
  await botSendText(
    opts.token,
    opts.chatId,
    "☝️ Forward this PPV to any fan. When they pay, I'll send you the unlocked media here with their name."
  );
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

