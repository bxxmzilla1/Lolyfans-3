import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSiteSetting, setSiteSetting } from "@/lib/siteSettings";
import { subPlanFromMetadata, subPriceLabel, type SubPlan } from "@/lib/subscriptionPlan";

/**
 * Platform admin bot: anyone who sends the admin code to the Telegram bot
 * gets notified about every signup, every USDC payment and every time a fan
 * starts chatting with another creator — across ALL creators.
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
// Fan notifications
// ---------------------------------------------------------------------------

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function planLine(plan: SubPlan): string {
  if (plan.priceCents <= 0) return "Free profile";
  if (plan.interval === "lifetime") return `Lifetime · ${subPriceLabel(plan)}`;
  const trial = plan.trialDays > 0 ? `${plan.trialDays}-day free trial · then ` : "";
  return `${trial}${subPriceLabel(plan)}`;
}

async function creatorInfo(ownerId: string): Promise<{ name: string; plan: SubPlan }> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(ownerId);
  const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const display = typeof meta.display_name === "string" ? meta.display_name.trim() : "";
  return { name: display || "Unnamed creator", plan: subPlanFromMetadata(meta) };
}

type FanRow = {
  id: string;
  owner_id: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_wallet: string | null;
  guest_city: string | null;
  guest_country: string | null;
};

async function fanContext(chatId: string) {
  const db = supabaseAdmin();
  const { data } = await db
    .from("chats")
    .select("id, owner_id, guest_name, guest_email, guest_wallet, guest_city, guest_country")
    .eq("id", chatId)
    .maybeSingle();
  const chat = (data as FanRow | null) ?? null;
  if (!chat) return null;

  // Every creator this fan chats with (same wallet or email).
  let allCreatorIds: string[] = [chat.owner_id];
  const filters: string[] = [];
  if (chat.guest_wallet) filters.push(`guest_wallet.eq.${chat.guest_wallet}`);
  if (chat.guest_email) filters.push(`guest_email.eq.${chat.guest_email}`);
  if (filters.length) {
    const { data: others } = await db.from("chats").select("owner_id").or(filters.join(","));
    const rows = (others ?? []) as { owner_id: string }[];
    allCreatorIds = [...new Set([chat.owner_id, ...rows.map((o) => o.owner_id)])];
  }
  return { chat, allCreatorIds };
}

function fanLines(chat: FanRow): string {
  const loc = [chat.guest_city, chat.guest_country].filter(Boolean).join(", ");
  const id = chat.guest_wallet
    ? `${chat.guest_wallet.slice(0, 4)}…${chat.guest_wallet.slice(-4)}`
    : chat.guest_email;
  return [
    `👤 <b>${esc(chat.guest_name || "Unknown")}</b>${id ? ` · ${esc(id)}` : ""}`,
    loc ? `📍 ${esc(loc)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * A fan paid in USDC (token pack, coupon or subscription period). Never
 * throws.
 */
export async function notifyCryptoPayment(
  chatId: string,
  amountCents: number,
  kind: string,
  tokens: number
) {
  if (!telegramConfigured()) return;
  try {
    const ctx = await fanContext(chatId);
    if (!ctx) return;
    const { name, plan } = await creatorInfo(ctx.chat.owner_id);
    const dollars = `$${(amountCents / 100).toFixed(2).replace(/\.00$/, "")}`;
    const what =
      kind === "subscription"
        ? "Subscription period"
        : kind === "coupon"
          ? `Coupon · ${tokens} Tokens`
          : `Token pack · ${tokens} Tokens`;
    const text = [
      `💰 <b>USDC payment · ${esc(dollars)}</b>`,
      fanLines(ctx.chat),
      "",
      `🧾 ${esc(what)}`,
      `⭐ Creator: <b>${esc(name)}</b>`,
      `📋 Plan: ${esc(planLine(plan))}`,
    ].join("\n");
    await notifyAdmins(text);
  } catch (err) {
    console.error("Telegram notifyCryptoPayment failed:", err);
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
    const { name, plan } = await creatorInfo(ownerId);
    const link = invite?.label || invite?.code;
    const text = [
      "🆕 <b>New signup</b>",
      fanLines(ctx.chat),
      "",
      `⭐ Creator: <b>${esc(name)}</b>`,
      `🧾 Plan: ${esc(planLine(plan))}`,
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
 * An existing fan just opened a chat with a new creator (Message button on
 * Home / another creator's link). `via` = how they got there. Never throws.
 */
export async function notifyCrossCreatorSubscribe(
  chatId: string,
  ownerId: string,
  sourceOwnerId?: string | null,
  via?: string | null
) {
  if (!telegramConfigured()) return;
  try {
    const ctx = await fanContext(chatId);
    if (!ctx) return;
    const [{ name, plan }, source] = await Promise.all([
      creatorInfo(ownerId),
      sourceOwnerId ? creatorInfo(sourceOwnerId) : Promise.resolve(null),
    ]);
    const total = ctx.allCreatorIds.length;
    const text = [
      "➕ <b>Fan started chatting with another creator</b>",
      fanLines(ctx.chat),
      "",
      `⭐ New creator: <b>${esc(name)}</b>`,
      `🧾 Plan: ${esc(planLine(plan))}`,
      source ? `↩️ Came from: ${esc(source.name)}` : null,
      via ? `📲 Via: ${esc(via)}` : null,
      `👥 Now chatting with ${total} creator${total === 1 ? "" : "s"}`,
    ]
      .filter((l) => l !== null)
      .join("\n");
    await notifyAdmins(text);
  } catch (err) {
    console.error("Telegram notifyCrossCreatorSubscribe failed:", err);
  }
}
