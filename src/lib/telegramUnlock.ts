import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { tgSessionFor, tgDeliverMedia, tgReactedMessageIds } from "@/lib/telegram";

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
};

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
 * Telegram DM. Safe to call from the one-tap charge, the card-wizard complete
 * step, or the Stripe webhook — the `delivered_at` guard prevents double sends.
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

  await db
    .from("telegram_unlocks")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      paid_chat_id: opts.chatId ?? unlock.paid_chat_id ?? null,
      stripe_payment_intent_id:
        opts.paymentIntentId ?? unlock.stripe_payment_intent_id ?? null,
    })
    .eq("id", unlock.id);

  const session = await tgSessionFor(unlock.owner_id);
  if (!session) return; // Telegram got disconnected — payment still recorded.

  try {
    await tgDeliverMedia({
      session,
      peer: unlock.tg_peer,
      mediaPath: unlock.media_path,
      mediaType: unlock.media_type,
    });
    await db
      .from("telegram_unlocks")
      .update({ delivered_at: new Date().toISOString() })
      .eq("id", unlock.id);
  } catch {
    // Delivery failed (session dropped, peer unreachable). Payment stays
    // recorded; the creator can resend from the app.
  }
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
