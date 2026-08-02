import "server-only";
import crypto from "crypto";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { createToken, verifyToken } from "@/lib/session";

/**
 * Telegram Login Widget support: fans tap "Log in with Telegram" on the
 * unlock page and we receive their Telegram identity, cryptographically
 * signed with the bot token. That identity is what saved cards are keyed on,
 * so PPV unlocks are one tap without a Lolyfans account.
 *
 * The bot is ONLY used to sign these logins (and must have the site domain
 * set via @BotFather /setdomain) — all DMs still go through the creator's
 * own connected account.
 */

export const TG_FAN_COOKIE = "loly_tg";

/** Widget payload freshness window — reject logins older than a day. */
const MAX_AUTH_AGE_SECONDS = 60 * 60 * 24;

export type TelegramLoginUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
};

export function telegramLoginConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_BOT_USERNAME;
}

/** The bot @username the widget renders with (without the @). */
export function telegramLoginBotUsername(): string | null {
  const name = (process.env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
  return telegramLoginConfigured() && name ? name : null;
}

/**
 * Verify a Login Widget payload: HMAC-SHA256 of the sorted key=value lines
 * with SHA256(bot_token) as the key must equal `hash`, and the login must be
 * recent. Returns the verified user or null.
 */
export function verifyTelegramLogin(
  data: Record<string, unknown>
): TelegramLoginUser | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const hash = typeof data.hash === "string" ? data.hash : "";
  if (!hash) return null;

  const checkString = Object.keys(data)
    .filter((k) => k !== "hash" && data[k] !== undefined && data[k] !== null)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");

  const secret = crypto.createHash("sha256").update(token).digest();
  const expected = crypto
    .createHmac("sha256", secret)
    .update(checkString)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const id = Number(data.id);
  const authDate = Number(data.auth_date);
  if (!Number.isFinite(id) || id <= 0) return null;
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return null;

  return {
    id,
    first_name: typeof data.first_name === "string" ? data.first_name : undefined,
    last_name: typeof data.last_name === "string" ? data.last_name : undefined,
    username: typeof data.username === "string" ? data.username : undefined,
    photo_url: typeof data.photo_url === "string" ? data.photo_url : undefined,
    auth_date: authDate,
  };
}

/** Signed cookie payload for a logged-in Telegram fan. */
export function createTgFanToken(user: TelegramLoginUser): string {
  return createToken({ tgId: user.id, tgUsername: user.username ?? null });
}

/** The logged-in Telegram fan from the cookie, or null. */
export async function getTelegramFan(): Promise<{
  id: number;
  username: string | null;
} | null> {
  const store = await cookies();
  const payload = verifyToken<{ tgId?: number; tgUsername?: string | null }>(
    store.get(TG_FAN_COOKIE)?.value
  );
  if (!payload?.tgId) return null;
  return { id: payload.tgId, username: payload.tgUsername ?? null };
}

export type TelegramFanRow = {
  tg_user_id: number;
  username: string | null;
  first_name: string | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
};

/** Load the fan's stored row (saved card etc.), or null. */
export async function telegramFanRow(
  tgUserId: number
): Promise<TelegramFanRow | null> {
  const { data } = await supabaseAdmin()
    .from("telegram_fans")
    .select(
      "tg_user_id, username, first_name, stripe_customer_id, stripe_payment_method_id"
    )
    .eq("tg_user_id", tgUserId)
    .maybeSingle();
  return (data as TelegramFanRow | null) ?? null;
}

/** Get (or create and store) the Stripe customer for a Telegram fan. */
export async function ensureTgFanStripeCustomer(
  tgUserId: number
): Promise<string> {
  const db = supabaseAdmin();
  const row = await telegramFanRow(tgUserId);
  if (row?.stripe_customer_id) return row.stripe_customer_id;

  const customer = await stripe().customers.create({
    name: row?.username ? `@${row.username}` : row?.first_name || undefined,
    metadata: { tgUserId: String(tgUserId) },
  });
  await db
    .from("telegram_fans")
    .update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() })
    .eq("tg_user_id", tgUserId);
  return customer.id;
}

/** Save the card used for an unlock so the next one is one tap. */
export async function saveTgFanPaymentMethod(
  tgUserId: number,
  customerId: string | null | undefined,
  paymentMethodId: string | null | undefined
) {
  const patch: Record<string, string> = { updated_at: new Date().toISOString() };
  if (customerId) patch.stripe_customer_id = customerId;
  if (paymentMethodId) patch.stripe_payment_method_id = paymentMethodId;
  await supabaseAdmin()
    .from("telegram_fans")
    .update(patch)
    .eq("tg_user_id", tgUserId);
}
