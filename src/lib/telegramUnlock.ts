import "server-only";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe, stripeConfigured } from "@/lib/stripe";
import {
  tgSessionFor,
  tgDeliverMedia,
  tgReactedMessageIds,
  tgSendText,
} from "@/lib/telegram";
import { getMediaCache } from "@/lib/telegramMediaCache";

export type TelegramUnlock = {
  id: string;
  owner_id: string;
  media_path: string;
  media_type: "image" | "video";
  price_cents: number;
  tg_peer: string;
  status: string;
  paid_chat_id: string | null;
  stripe_payment_intent_id: string | null;
  delivered_at: string | null;
  short_code?: string | null;
  tg_message_id?: number | null;
  /** Saved Messages copy of the clear media — enables instant delivery. */
  tg_cached_message_id?: number | null;
};

/**
 * True when the current request came in on the dedicated pay-link domain
 * (PPV_PAYLINK_ORIGIN) — unlock pages show TelegramPay branding there.
 */
export async function onPayLinkDomain(): Promise<boolean> {
  const raw = (process.env.PPV_PAYLINK_ORIGIN || "").trim();
  if (!raw) return false;
  // Ignore "www." on either side — Vercel 308s the apex domain to www, so
  // the serving host may differ from the configured origin by that prefix.
  const normalize = (host: string) => host.toLowerCase().replace(/^www\./, "");
  let payHost = "";
  try {
    payHost = normalize(
      new URL(raw.includes("://") ? raw : `https://${raw}`).host
    );
  } catch {
    return false;
  }
  const h = await headers();
  const host = normalize(h.get("x-forwarded-host") || h.get("host") || "");
  return host === payHost;
}

export async function getUnlock(id: string): Promise<TelegramUnlock | null> {
  const { data } = await supabaseAdmin()
    .from("telegram_unlocks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as TelegramUnlock | null) ?? null;
}

/** Resolve a short pay-link code (lolyfans.com/payment/<code>). */
export async function getUnlockByCode(
  code: string
): Promise<TelegramUnlock | null> {
  if (!code) return null;
  const { data } = await supabaseAdmin()
    .from("telegram_unlocks")
    .select("*")
    .eq("short_code", code)
    .maybeSingle();
  return (data as TelegramUnlock | null) ?? null;
}

/**
 * Mark an unlock paid (idempotent) and deliver the clear media into the fan's
 * Telegram DM. Safe to call concurrently from the one-tap charge, the
 * card-wizard complete step, the reaction charger and the Stripe webhook —
 * `deliverUnlock` takes an atomic claim, so the media is only ever sent once.
 */
export async function markPaidAndDeliver(opts: {
  unlock: TelegramUnlock;
  chatId?: string | null;
  paymentIntentId?: string | null;
}): Promise<void> {
  const db = supabaseAdmin();
  const { unlock } = opts;

  // Already delivered? Nothing to do.
  if (unlock.delivered_at) return;

  // Record the payment — but never clobber "delivering", or a concurrent
  // caller (e.g. the webhook) could reset the claim and send a second copy.
  await db
    .from("telegram_unlocks")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      paid_chat_id: opts.chatId ?? unlock.paid_chat_id ?? null,
      stripe_payment_intent_id:
        opts.paymentIntentId ?? unlock.stripe_payment_intent_id ?? null,
    })
    .eq("id", unlock.id)
    .in("status", ["pending", "charging", "react_failed"]);

  await deliverUnlock(unlock);
}

/**
 * Deliver the clear media for a paid unlock, exactly once. Claims the row
 * atomically (paid → delivering), so concurrent callers can't double-send.
 * On failure the row returns to "paid" with no delivered_at, and the cron
 * scan retries it; a claim orphaned by a killed function (timeout mid-upload)
 * becomes reclaimable after 5 minutes via `reclaimStale`.
 */
export async function deliverUnlock(
  unlock: TelegramUnlock,
  opts?: { reclaimStale?: boolean }
): Promise<boolean> {
  const db = supabaseAdmin();
  if (unlock.delivered_at) return false;

  // Atomic claim: exactly one caller moves paid → delivering.
  const { data: claimed } = await db
    .from("telegram_unlocks")
    .update({ status: "delivering" })
    .eq("id", unlock.id)
    .eq("status", "paid")
    .is("delivered_at", null)
    .select("id");

  let owned = !!claimed?.length;
  if (!owned && opts?.reclaimStale) {
    // A previous deliverer died mid-send (function timeout). Re-claim by
    // bumping paid_at — atomic, so two retry runners can't both win.
    const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: reclaimed } = await db
      .from("telegram_unlocks")
      .update({ paid_at: new Date().toISOString() })
      .eq("id", unlock.id)
      .eq("status", "delivering")
      .is("delivered_at", null)
      .lt("paid_at", staleBefore)
      .select("id");
    owned = !!reclaimed?.length;
  }
  if (!owned) return false;

  const session = await tgSessionFor(unlock.owner_id);
  if (!session) {
    // Telegram got disconnected — payment stays recorded, retried later.
    await db
      .from("telegram_unlocks")
      .update({ status: "paid" })
      .eq("id", unlock.id)
      .eq("status", "delivering");
    return false;
  }

  try {
    // Saved Messages copy for instant delivery: the one pinned to this
    // unlock, or the shared vault-wide cache (filled by the backfill
    // worker) when the unlock predates it.
    let cachedMessageId = unlock.tg_cached_message_id ?? null;
    if (!cachedMessageId) {
      cachedMessageId =
        (await getMediaCache(unlock.owner_id, unlock.media_path).catch(
          () => null
        ))?.tgMessageId ?? null;
    }
    await tgDeliverMedia({
      session,
      peer: unlock.tg_peer,
      mediaPath: unlock.media_path,
      mediaType: unlock.media_type,
      cachedMessageId,
    });
    await db
      .from("telegram_unlocks")
      .update({ status: "paid", delivered_at: new Date().toISOString() })
      .eq("id", unlock.id);
    return true;
  } catch {
    // Delivery failed (peer unreachable, upload error). Release the claim so
    // the cron scan retries.
    await db
      .from("telegram_unlocks")
      .update({ status: "paid" })
      .eq("id", unlock.id)
      .eq("status", "delivering");
    return false;
  }
}

/**
 * Retry deliveries for unlocks that were paid but never (fully) delivered —
 * e.g. a big video upload that outlived the function that started it.
 */
export async function retryUndeliveredUnlocks(ownerId: string): Promise<void> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data } = await db
    .from("telegram_unlocks")
    .select("*")
    .eq("owner_id", ownerId)
    .in("status", ["paid", "delivering"])
    .is("delivered_at", null)
    .gte("created_at", since)
    .order("paid_at", { ascending: true })
    .limit(10);
  for (const unlock of (data as TelegramUnlock[] | null) ?? []) {
    await deliverUnlock(unlock, { reclaimStale: true });
  }
}

/**
 * Chat holding a saved card for this Telegram peer, if any — i.e. the fan
 * has paid this creator before and their card is on file, so reaction-to-pay
 * (and one-tap web pay) will work for them.
 */
export async function savedCardChatForPeer(
  ownerId: string,
  peer: string
): Promise<string | null> {
  const db = supabaseAdmin();
  const { data: prior } = await db
    .from("telegram_unlocks")
    .select("paid_chat_id")
    .eq("owner_id", ownerId)
    .eq("tg_peer", peer)
    .eq("status", "paid")
    .not("paid_chat_id", "is", null)
    .order("paid_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const chatId = (prior?.paid_chat_id as string | null) ?? null;
  if (!chatId) return null;

  const { data: chat } = await db
    .from("chats")
    .select("stripe_customer_id, stripe_payment_method_id")
    .eq("id", chatId)
    .maybeSingle();
  return chat?.stripe_customer_id && chat?.stripe_payment_method_id
    ? chatId
    : null;
}

/**
 * Chat to save a paying fan's card to, so double-tap (reaction) unlocks work
 * from their very first web payment.
 *
 * Fans opening pay links on the dedicated pay domain usually can't be
 * recognised as Lolyfans guests (the guest cookie lives on the app's own
 * domain), so their card used to be attached to an orphan Stripe customer
 * and every following PPV fell back to a payment link. Instead: reuse the
 * chat from any earlier paid unlock of the same Telegram peer, or create a
 * hidden (pending) chat that exists just to hold the fan's saved card.
 */
export async function fanChatForCard(opts: {
  unlock: TelegramUnlock;
  ip?: string | null;
  country?: string | null;
}): Promise<string | null> {
  const db = supabaseAdmin();
  const { unlock } = opts;

  const { data: prior } = await db
    .from("telegram_unlocks")
    .select("paid_chat_id")
    .eq("owner_id", unlock.owner_id)
    .eq("tg_peer", unlock.tg_peer)
    .not("paid_chat_id", "is", null)
    .order("paid_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (prior?.paid_chat_id) return prior.paid_chat_id as string;

  const { data: created } = await db
    .from("chats")
    .insert({
      owner_id: unlock.owner_id,
      guest_name: unlock.tg_peer.startsWith("@")
        ? unlock.tg_peer
        : "Telegram fan",
      guest_ip: opts.ip ?? null,
      guest_country: opts.country ?? null,
      // Hidden from the creator's Lolyfans inbox — this row only carries
      // the saved card (and geo) for a Telegram-side fan.
      pending: true,
    })
    .select("id")
    .single();
  return (created?.id as string | undefined) ?? null;
}

/**
 * Origin used for PPV pay links. Accepts bare hosts ("payontele.com") or full
 * URLs ("https://payontele.com") — always returns an https origin with no
 * trailing slash. Falls back to the given value (or lolyfans) when unset.
 */
export function payLinkOrigin(fallback = "https://www.lolyfans.com"): string {
  const raw = (process.env.PPV_PAYLINK_ORIGIN || "").trim().replace(/\/+$/, "");
  if (!raw) return fallback.replace(/\/+$/, "");
  return raw.includes("://") ? raw : `https://${raw}`;
}

/** Public pay-page link for an unlock (dedicated pay domain when configured). */
function payLinkFor(unlock: TelegramUnlock): string {
  const origin = payLinkOrigin();
  return unlock.short_code
    ? `${origin}/payment/${unlock.short_code}`
    : `${origin}/u/${unlock.id}`;
}

/** DM the fan the web pay link for this unlock (reply to the teaser). */
async function sendPayLinkFallback(opts: {
  unlock: TelegramUnlock;
  session: string;
}): Promise<void> {
  try {
    await tgSendText({
      session: opts.session,
      peer: opts.unlock.tg_peer,
      text: `⚠️ Your card payment didn't go through. Unlock it here by entering your card again: ${payLinkFor(opts.unlock)}`,
      replyToId: opts.unlock.tg_message_id ?? null,
    });
  } catch {
    // Fan can still open the link later — the unlock stays payable by web.
  }
}

/**
 * A reaction charge failed (declined / expired card). Park the unlock for web
 * pay, forget the dead saved card — so this fan's future PPVs carry the
 * payment link again and the pay page opens the card form directly — and DM
 * them the link so they can pay with fresh card details right away.
 */
async function reactionChargeFailed(opts: {
  unlock: TelegramUnlock;
  chatId: string;
  session: string;
}): Promise<void> {
  const db = supabaseAdmin();
  await db
    .from("telegram_unlocks")
    .update({ status: "react_failed" })
    .eq("id", opts.unlock.id);
  await db
    .from("chats")
    .update({ stripe_payment_method_id: null })
    .eq("id", opts.chatId);
  await sendPayLinkFallback(opts);
}

/**
 * Reaction-to-pay: fans who already paid once (saved card) can unlock a PPV
 * by double-tapping (reacting to) the teaser message in Telegram.
 *
 * Scans the creator's recent pending unlocks for reactions on the teaser,
 * finds the fan's saved card via their previous paid unlock from the same
 * Telegram peer, and charges it off-session. An atomic `pending → charging`
 * status claim means each PPV can only ever be charged once, no matter how
 * many times the fan reacts. A failed charge parks the row in `react_failed`,
 * drops the dead saved card (future PPVs go back to payment links) and DMs
 * the fan the pay link so they can enter fresh card details on the web.
 */
export async function chargeReactionUnlocks(
  ownerId: string,
  session: string
): Promise<void> {
  if (!stripeConfigured()) return;
  const db = supabaseAdmin();

  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data } = await db
    .from("telegram_unlocks")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("status", "pending")
    .not("tg_message_id", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(30);
  const pending = ((data as TelegramUnlock[] | null) ?? []).filter(
    (u) =>
      // Only DMs — in a group or channel we can't tell who reacted.
      !u.tg_peer.startsWith("channel:") && !u.tg_peer.startsWith("chat:")
  );
  if (!pending.length) return;

  // One reactions lookup per peer.
  const byPeer = new Map<string, TelegramUnlock[]>();
  for (const u of pending) {
    byPeer.set(u.tg_peer, [...(byPeer.get(u.tg_peer) ?? []), u]);
  }

  for (const [peer, unlocks] of byPeer) {
    let reacted: Set<number>;
    try {
      reacted = await tgReactedMessageIds({
        session,
        peer,
        ids: unlocks.map((u) => Number(u.tg_message_id)),
      });
    } catch {
      continue; // peer unreachable — try again on the next poll
    }
    if (!reacted.size) continue;

    // The fan's saved card: whatever chat their last paid unlock from this
    // peer was charged to (looked up without requiring the card to still be
    // on file — a dropped card is handled below with the pay-link fallback).
    const { data: prior } = await db
      .from("telegram_unlocks")
      .select("paid_chat_id")
      .eq("owner_id", ownerId)
      .eq("tg_peer", peer)
      .eq("status", "paid")
      .not("paid_chat_id", "is", null)
      .order("paid_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const chatId = (prior?.paid_chat_id as string | null) ?? null;
    if (!chatId) continue; // never paid before — their teaser carries the link

    const { data: chat } = await db
      .from("chats")
      .select("stripe_customer_id, stripe_payment_method_id")
      .eq("id", chatId)
      .maybeSingle();
    const customer = (chat?.stripe_customer_id as string | null) ?? null;
    const pm = (chat?.stripe_payment_method_id as string | null) ?? null;

    if (!customer || !pm) {
      // Saved card is gone (e.g. dropped after a failed charge), so reacting
      // can't pay — point the fan at the payment link instead. The atomic
      // pending → react_failed claim makes sure the DM goes out only once.
      for (const unlock of unlocks) {
        if (!reacted.has(Number(unlock.tg_message_id))) continue;
        const { data: claimed } = await db
          .from("telegram_unlocks")
          .update({ status: "react_failed" })
          .eq("id", unlock.id)
          .eq("status", "pending")
          .select("id");
        if (!claimed?.length) continue;
        await sendPayLinkFallback({ unlock, session });
      }
      continue;
    }

    for (const unlock of unlocks) {
      if (!reacted.has(Number(unlock.tg_message_id))) continue;

      // Atomic claim: only one runner ever moves pending → charging.
      const { data: claimed } = await db
        .from("telegram_unlocks")
        .update({ status: "charging" })
        .eq("id", unlock.id)
        .eq("status", "pending")
        .select("id");
      if (!claimed?.length) continue;

      try {
        const pi = await stripe().paymentIntents.create({
          amount: unlock.price_cents,
          currency: "usd",
          customer,
          payment_method: pm,
          off_session: true,
          confirm: true,
          metadata: {
            kind: "tg-unlock",
            unlockId: unlock.id,
            chatId,
            via: "reaction",
          },
          description: "Telegram unlock (reaction)",
        });
        if (pi.status === "succeeded") {
          await markPaidAndDeliver({ unlock, chatId, paymentIntentId: pi.id });
        } else {
          await reactionChargeFailed({ unlock, chatId, session });
        }
      } catch {
        // Declined / needs authentication — fall back to the payment link.
        await reactionChargeFailed({ unlock, chatId, session });
      }
    }
  }
}
