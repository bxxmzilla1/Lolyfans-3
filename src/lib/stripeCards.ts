import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { ACTIVE_SUB_STATUSES } from "@/lib/subscriptionAccess";

/**
 * Stripe's "No such customer / payment_method / subscription" — the id was
 * created under a different Stripe account (or deleted there). Such a card
 * can never be charged from this account, so it must not count as saved.
 */
export function isStaleStripeIdError(err: unknown): boolean {
  const e = (err ?? {}) as { code?: string; message?: string };
  return (
    e.code === "resource_missing" ||
    /No such (customer|payment_method|subscription|setup_intent)/i.test(e.message ?? "")
  );
}

/** Forget the saved card: the fan is asked for one again on the next purchase. */
export async function clearChatCard(chatId: string) {
  await supabaseAdmin()
    .from("chats")
    .update({ stripe_customer_id: null, stripe_payment_method_id: null })
    .eq("id", chatId);
}

/**
 * After a failed one-tap charge: if it failed because the card doesn't exist
 * in this Stripe account, drop it so the card wizard shows instead of every
 * later attempt failing the same way. Returns true when the card was dropped.
 */
export async function dropCardIfStale(chatId: string, err: unknown): Promise<boolean> {
  if (!isStaleStripeIdError(err)) return false;
  await clearChatCard(chatId);
  return true;
}

type Check = "ok" | "stale-customer" | "stale-card";

/** Does this customer + card exist in the connected Stripe account? */
async function checkCard(
  customerId: string | null,
  paymentMethodId: string | null
): Promise<Check> {
  const s = stripe();
  if (customerId) {
    try {
      const c = await s.customers.retrieve(customerId);
      if (c.deleted) return "stale-customer";
    } catch (err) {
      if (isStaleStripeIdError(err)) return "stale-customer";
      throw err;
    }
  }
  if (paymentMethodId) {
    try {
      const pm = await s.paymentMethods.retrieve(paymentMethodId);
      const owner = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
      // Detached or attached to some other customer → not usable for this chat.
      if (!owner || (customerId && owner !== customerId)) return "stale-card";
    } catch (err) {
      if (isStaleStripeIdError(err)) return "stale-card";
      throw err;
    }
  }
  return "ok";
}

const PAGE = 40;
const CONCURRENCY = 6;

export type PruneResult = {
  checked: number;
  /** Chats whose saved card was removed. */
  cleared: number;
  /** Subscriptions that only existed in the other Stripe account. */
  subscriptionsClosed: number;
  /** Continue from here (null = finished). */
  nextCursor: string | null;
};

/**
 * One page of the cleanup: verifies every chat's saved Stripe customer/card
 * against the CURRENT Stripe account and clears the ones that don't exist
 * there. Cursor-paginated by chat id so the client can loop until done
 * without hitting the serverless timeout. The last page also closes
 * subscriptions whose Stripe object isn't in this account.
 */
export async function pruneStaleCards(cursor: string | null): Promise<PruneResult> {
  const db = supabaseAdmin();
  let q = db
    .from("chats")
    .select("id, stripe_customer_id, stripe_payment_method_id")
    .or("stripe_customer_id.not.is.null,stripe_payment_method_id.not.is.null")
    .order("id", { ascending: true })
    .limit(PAGE);
  if (cursor) q = q.gt("id", cursor);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  let cleared = 0;
  // Small worker pool so a big fan base doesn't fire hundreds of Stripe calls at once.
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
      while (i < rows.length) {
        const row = rows[i++];
        const verdict = await checkCard(
          (row.stripe_customer_id as string | null) ?? null,
          (row.stripe_payment_method_id as string | null) ?? null
        );
        if (verdict === "stale-customer") {
          await clearChatCard(row.id as string);
          cleared++;
        } else if (verdict === "stale-card") {
          // Customer is fine here; only the card is unusable.
          await db
            .from("chats")
            .update({ stripe_payment_method_id: null })
            .eq("id", row.id as string);
          cleared++;
        }
      }
    })
  );

  const done = rows.length < PAGE;
  const subscriptionsClosed = done ? await pruneStaleSubscriptions() : 0;
  return {
    checked: rows.length,
    cleared,
    subscriptionsClosed,
    nextCursor: done ? null : (rows[rows.length - 1].id as string),
  };
}

/**
 * Active subscriptions whose Stripe subscription lives in another account
 * can't renew or be cancelled from here — mark them canceled so they stop
 * granting access without a valid card.
 */
async function pruneStaleSubscriptions(): Promise<number> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("subscriptions")
    .select("chat_id, owner_id, stripe_subscription_id")
    .not("stripe_subscription_id", "is", null)
    .in("status", ACTIVE_SUB_STATUSES)
    .limit(500);
  const s = stripe();
  let closed = 0;
  for (const row of data ?? []) {
    try {
      await s.subscriptions.retrieve(row.stripe_subscription_id as string);
    } catch (err) {
      if (!isStaleStripeIdError(err)) continue;
      await db
        .from("subscriptions")
        .update({ status: "canceled" })
        .eq("chat_id", row.chat_id as string)
        .eq("owner_id", row.owner_id as string);
      closed++;
    }
  }
  return closed;
}
