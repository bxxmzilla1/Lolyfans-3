import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSiteSetting, setSiteSetting } from "@/lib/siteSettings";

/**
 * Platform admin bot: anyone who sends the admin code to the Telegram bot
 * gets notified about every signup, first card verification and
 * cross-creator subscribe across ALL creators.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN      — from @BotFather (required for the bot to work)
 *   TELEGRAM_WEBHOOK_SECRET — optional; sent by Telegram on every update and
 *                             checked by the webhook route
 *   ADMIN_NOTIFY_CODE       — optional override of the default admin code
 */
export const ADMIN_NOTIFY_CODE = process.env.ADMIN_NOTIFY_CODE || "242124";

/** site_settings key: JSON array of Telegram chat ids that entered the code. */
const ADMIN_CHATS_KEY = "telegram_admin_chat_ids";

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

function api(method: string) {
  return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
}

export async function telegramCall<T = unknown>(
  method: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; result?: T; description?: string }> {
  if (!telegramConfigured()) return { ok: false, description: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const res = await fetch(api(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as { ok: boolean; result?: T; description?: string };
  } catch (err) {
    return { ok: false, description: String(err) };
  }
}

export async function sendTelegram(chatId: number | string, text: string) {
  return telegramCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

// ---------------------------------------------------------------------------
// Who gets notified
// ---------------------------------------------------------------------------

export async function getAdminChatIds(): Promise<string[]> {
  const { value } = await getSiteSetting(ADMIN_CHATS_KEY);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function saveAdminChatIds(ids: string[]) {
  return setSiteSetting(ADMIN_CHATS_KEY, ids.length ? JSON.stringify(ids) : null);
}

/** Returns true if the chat was newly added. */
export async function addAdminChat(chatId: number | string): Promise<boolean> {
  const id = String(chatId);
  const ids = await getAdminChatIds();
  if (ids.includes(id)) return false;
  await saveAdminChatIds([...ids, id]);
  return true;
}

export async function removeAdminChat(chatId: number | string): Promise<boolean> {
  const id = String(chatId);
  const ids = await getAdminChatIds();
  if (!ids.includes(id)) return false;
  await saveAdminChatIds(ids.filter((x) => x !== id));
  return true;
}

export async function isAdminChat(chatId: number | string): Promise<boolean> {
  return (await getAdminChatIds()).includes(String(chatId));
}

/** Fan out one message to every admin chat. Never throws. */
export async function notifyAdmins(text: string) {
  if (!telegramConfigured()) return;
  const ids = await getAdminChatIds();
  await Promise.all(
    ids.map(async (id) => {
      const res = await sendTelegram(id, text);
      // The user blocked the bot / deleted the chat → stop trying.
      if (!res.ok && /blocked|deactivated|chat not found/i.test(res.description || "")) {
        await removeAdminChat(id);
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Card-verification notifications
// ---------------------------------------------------------------------------

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function creatorName(ownerId: string): Promise<string> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(ownerId);
  const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const display = typeof meta.display_name === "string" ? meta.display_name.trim() : "";
  return display || "Unnamed creator";
}

type FanRow = {
  id: string;
  owner_id: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_city: string | null;
  guest_country: string | null;
};

async function fanContext(chatId: string) {
  const db = supabaseAdmin();
  const { data } = await db
    .from("chats")
    .select("id, owner_id, guest_name, guest_email, guest_city, guest_country")
    .eq("id", chatId)
    .maybeSingle();
  const chat = (data as FanRow | null) ?? null;
  if (!chat) return null;

  // Every creator this fan now has a verified card with (same email).
  let creatorIds: string[] = [chat.owner_id];
  if (chat.guest_email) {
    const { data: others } = await db
      .from("chats")
      .select("owner_id")
      .eq("guest_email", chat.guest_email)
      .not("stripe_payment_method_id", "is", null);
    creatorIds = [...new Set([chat.owner_id, ...(others ?? []).map((o) => o.owner_id as string)])];
  }
  return { chat, creatorIds };
}

function fanLines(chat: FanRow): string {
  const loc = [chat.guest_city, chat.guest_country].filter(Boolean).join(", ");
  return [
    `👤 <b>${esc(chat.guest_name || "Unknown")}</b>${chat.guest_email ? ` · ${esc(chat.guest_email)}` : ""}`,
    loc ? `📍 ${esc(loc)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * A fan's card was saved for the first time (their first top-up / unlock
 * with a creator — one-tap purchases work from here on).
 * Call AFTER the card is saved on the chat. Never throws.
 */
export async function notifyCardVerified(chatId: string, ownerId: string) {
  if (!telegramConfigured()) return;
  try {
    const ctx = await fanContext(chatId);
    if (!ctx) return;
    const name = await creatorName(ownerId);
    const others = ctx.creatorIds.filter((id) => id !== ownerId).length;
    const text = [
      "💳 <b>New card verified</b>",
      fanLines(ctx.chat),
      "",
      `⭐ Creator: <b>${esc(name)}</b>`,
      others > 0 ? `🔗 Also subscribed to ${others} other creator${others === 1 ? "" : "s"}` : null,
    ]
      .filter((l) => l !== null)
      .join("\n");
    await notifyAdmins(text);
  } catch (err) {
    console.error("Telegram notifyCardVerified failed:", err);
  }
}

/**
 * A visitor just created an account through a creator's link. Never throws.
 */
export async function notifySignup(
  chatId: string,
  ownerId: string,
  invite?: { label?: string | null; code?: string | null } | null
) {
  if (!telegramConfigured()) return;
  try {
    const ctx = await fanContext(chatId);
    if (!ctx) return;
    const name = await creatorName(ownerId);
    const link = invite?.label || invite?.code;
    const text = [
      "🆕 <b>New signup</b>",
      fanLines(ctx.chat),
      "",
      `⭐ Creator: <b>${esc(name)}</b>`,
      link ? `🔗 Link: ${esc(link)}` : null,
    ]
      .filter((l) => l !== null)
      .join("\n");
    await notifyAdmins(text);
  } catch (err) {
    console.error("Telegram notifySignup failed:", err);
  }
}

/**
 * A fan who already had a verified card (with another creator) just
 * subscribed to a new creator — the card was copied onto the new chat.
 * Never throws.
 */
export async function notifyCrossCreatorSubscribe(
  chatId: string,
  ownerId: string,
  sourceOwnerId?: string | null
) {
  if (!telegramConfigured()) return;
  try {
    const ctx = await fanContext(chatId);
    if (!ctx) return;
    const [name, sourceName] = await Promise.all([
      creatorName(ownerId),
      sourceOwnerId ? creatorName(sourceOwnerId) : Promise.resolve(null),
    ]);
    const total = ctx.creatorIds.length;
    const text = [
      "🔁 <b>Verified fan subscribed to another creator</b>",
      fanLines(ctx.chat),
      "",
      `⭐ New creator: <b>${esc(name)}</b>`,
      sourceName ? `💳 Card verified with: ${esc(sourceName)}` : null,
      `👥 Now subscribed to ${total} creator${total === 1 ? "" : "s"}`,
    ]
      .filter((l) => l !== null)
      .join("\n");
    await notifyAdmins(text);
  } catch (err) {
    console.error("Telegram notifyCrossCreatorSubscribe failed:", err);
  }
}
