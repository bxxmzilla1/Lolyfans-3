import "server-only";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { tgSessionFor, tgDeliverMedia, tgReactedMessageIds } from "@/lib/telegram";
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
 * Reaction-to-pay: fans who already paid once (saved card) can unlock a PPV
 * by double-tapping (reacting to) the teaser message in Telegram.
 *
 * Scans the creator's recent pending unlocks for reactions on the teaser,
 * finds the fan's saved card via their previous paid unlock from the same
 * Telegram peer, and charges it off-session. An atomic `pending → charging`
 * status claim means each PPV can only ever be charged once, no matter how
 * many times the fan reacts. Failed charges park the row in `react_failed`
 * (never retried automatically; the web pay link still works).
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
    // peer was charged to.
    const chatId = await savedCardChatForPeer(ownerId, peer);
    if (!chatId) continue; // never paid before — reaction can't charge them

    const { data: chat } = await db
      .from("chats")
      .select("stripe_customer_id, stripe_payment_method_id")
      .eq("id", chatId)
      .maybeSingle();
    const customer = (chat?.stripe_customer_id as string | null) ?? null;
    const pm = (chat?.stripe_payment_method_id as string | null) ?? null;
    if (!customer || !pm) continue;

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
          await db
            .from("telegram_unlocks")
            .update({ status: "react_failed" })
            .eq("id", unlock.id);
        }
      } catch {
        // Declined / needs authentication — leave it for the web pay link.
        await db
          .from("telegram_unlocks")
          .update({ status: "react_failed" })
          .eq("id", unlock.id);
      }
    }
  }
}
