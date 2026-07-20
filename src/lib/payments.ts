import { supabaseAdmin } from "@/lib/supabase/admin";
import { broadcast } from "@/lib/realtime";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

/** Record that a fan unlocked a message (idempotent) and notify the chat. */
export async function recordUnlock(opts: {
  messageId: string;
  chatId: string;
  priceCents: number;
}) {
  const db = supabaseAdmin();
  await db.from("message_unlocks").upsert(
    {
      message_id: opts.messageId,
      chat_id: opts.chatId,
      price_cents: opts.priceCents,
    },
    { onConflict: "message_id,chat_id", ignoreDuplicates: true }
  );
  await broadcast(`chat:${opts.chatId}`, "message-unlocked", {
    messageId: opts.messageId,
  });
}

/** Format a tip bubble's text content. */
export function tipMessageContent(amountCents: number, caption: string): string {
  const dollars = (amountCents / 100).toFixed(2).replace(/\.00$/, "");
  const head = `💸 Tip · $${dollars}`;
  const body = caption.trim();
  return body ? `${head}\n${body}` : head;
}

/** Persist a tip as a guest chat message and notify both sides. */
export async function postTipMessage(opts: {
  chatId: string;
  amountCents: number;
  caption: string;
  ownerId: string;
}) {
  const db = supabaseAdmin();
  const content = tipMessageContent(opts.amountCents, opts.caption);
  const { data: message, error } = await db
    .from("messages")
    .insert({
      chat_id: opts.chatId,
      sender: "guest",
      content,
    })
    .select()
    .single();
  if (error || !message) throw new Error(error?.message || "Could not post tip");

  const now = message.created_at as string;
  await Promise.all([
    db.from("chats").update({ last_message_at: now }).eq("id", opts.chatId),
    broadcast(`chat:${opts.chatId}`, "new-message", message),
    broadcast(`inbox:${opts.ownerId}`, "new-message", { chatId: opts.chatId }),
  ]);
  return message;
}

/**
 * Get (or create) the chat's Stripe customer, carrying the fan's signup
 * name/email so Checkout never asks for them again.
 */
export async function ensureStripeCustomer(chatId: string): Promise<string> {
  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("stripe_customer_id, guest_name, guest_email")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) throw new Error("Chat not found");

  const email = (chat.guest_email as string | null) || undefined;
  const name = (chat.guest_name as string | null) || undefined;

  if (chat.stripe_customer_id) {
    // Backfill contact info onto customers created before we passed it, so
    // their Checkout email is prefilled too.
    if (email || name) {
      await stripe()
        .customers.update(chat.stripe_customer_id, { email, name })
        .catch(() => {});
    }
    return chat.stripe_customer_id as string;
  }

  const customer = await stripe().customers.create({
    email,
    name,
    metadata: { chatId },
  });
  await db.from("chats").update({ stripe_customer_id: customer.id }).eq("id", chatId);
  return customer.id;
}

/** Save Stripe customer + card on the chat for future one-tap charges. */
export async function saveStripePaymentMethod(
  chatId: string,
  customerId: string | null | undefined,
  paymentMethodId: string | null | undefined
) {
  const patch: Record<string, string> = {};
  if (customerId) patch.stripe_customer_id = customerId;
  if (paymentMethodId) patch.stripe_payment_method_id = paymentMethodId;
  if (!Object.keys(patch).length) return;
  await supabaseAdmin().from("chats").update(patch).eq("id", chatId);
}

/** Record a paid lifetime subscription (idempotent) and keep the fan following. */
export async function recordLifetimeSubscription(opts: {
  chatId: string;
  ownerId: string;
  priceCents: number;
}) {
  const db = supabaseAdmin();
  await db.from("subscriptions").upsert(
    {
      chat_id: opts.chatId,
      owner_id: opts.ownerId,
      stripe_subscription_id: null,
      status: "active",
      price_cents: opts.priceCents,
      billing_interval: "lifetime",
      current_period_end: null,
    },
    { onConflict: "chat_id,owner_id" }
  );
  await db.from("follows").upsert(
    { chat_id: opts.chatId, owner_id: opts.ownerId },
    { onConflict: "chat_id,owner_id", ignoreDuplicates: true }
  );
}

/**
 * Mirror a Stripe subscription into the subscriptions table (created,
 * renewed, canceled…) and keep the fan following the creator while active.
 */
export async function syncSubscription(sub: Stripe.Subscription) {
  const chatId = sub.metadata?.chatId;
  const ownerId = sub.metadata?.ownerId;
  if (!chatId || !ownerId) return;

  const db = supabaseAdmin();
  const item = sub.items.data[0];
  const priceCents = item?.price?.unit_amount ?? 0;
  const interval = item?.price?.recurring?.interval ?? "month";
  const periodEnd = (item as { current_period_end?: number } | undefined)
    ?.current_period_end;

  const status =
    sub.status === "canceled" || sub.status === "incomplete_expired"
      ? "canceled"
      : sub.cancel_at_period_end
        ? "canceling"
        : sub.status;

  await db.from("subscriptions").upsert(
    {
      chat_id: chatId,
      owner_id: ownerId,
      stripe_subscription_id: sub.id,
      status,
      price_cents: priceCents,
      billing_interval: interval,
      current_period_end: periodEnd
        ? new Date(periodEnd * 1000).toISOString()
        : null,
    },
    { onConflict: "chat_id,owner_id" }
  );

  if (status !== "canceled") {
    await db.from("follows").upsert(
      { chat_id: chatId, owner_id: ownerId },
      { onConflict: "chat_id,owner_id", ignoreDuplicates: true }
    );
  }
}

async function paymentMethodFromSession(session: Stripe.Checkout.Session) {
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  let paymentMethodId: string | null = null;
  if (paymentIntentId) {
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId);
    paymentMethodId =
      typeof pi.payment_method === "string"
        ? pi.payment_method
        : pi.payment_method?.id ?? null;
  }
  return { customerId, paymentMethodId };
}

/**
 * After a paid Checkout session: save the card and fulfill unlock, tip, or
 * subscription. Safe to call from the webhook or from the return URL.
 */
export async function fulfillCheckout(session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid" && session.status !== "complete") {
    return { ok: false as const, kind: null };
  }
  const kind = session.metadata?.kind;
  const chatId = session.metadata?.chatId;
  if (!chatId || (kind !== "unlock" && kind !== "tip" && kind !== "subscription")) {
    return { ok: false as const, kind: null };
  }

  if (kind === "subscription") {
    // Lifetime plan: a one-time payment, no Stripe subscription object.
    if (session.metadata?.interval === "lifetime") {
      const ownerId = session.metadata?.ownerId;
      if (!ownerId) return { ok: false as const, kind: "subscription" as const };
      const { customerId, paymentMethodId } = await paymentMethodFromSession(session);
      await saveStripePaymentMethod(chatId, customerId, paymentMethodId);
      await recordLifetimeSubscription({
        chatId,
        ownerId,
        priceCents: session.amount_total ?? 0,
      });
      return { ok: true as const, kind: "subscription" as const, messageId: null };
    }

    const subId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    if (!subId) return { ok: false as const, kind: "subscription" as const };
    const sub = await stripe().subscriptions.retrieve(subId);

    // The card that pays the subscription doubles as the saved card for
    // one-tap unlocks and tips.
    const customerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id;
    let pmId =
      typeof sub.default_payment_method === "string"
        ? sub.default_payment_method
        : sub.default_payment_method?.id ?? null;
    if (!pmId && customerId) {
      const customer = await stripe().customers.retrieve(customerId);
      if (!("deleted" in customer) || !customer.deleted) {
        const dpm = (customer as Stripe.Customer).invoice_settings
          ?.default_payment_method;
        pmId = typeof dpm === "string" ? dpm : dpm?.id ?? null;
      }
    }
    await saveStripePaymentMethod(chatId, customerId, pmId);
    await syncSubscription(sub);
    return { ok: true as const, kind: "subscription" as const, messageId: null };
  }

  const { customerId, paymentMethodId } = await paymentMethodFromSession(session);
  await saveStripePaymentMethod(chatId, customerId, paymentMethodId);

  if (kind === "unlock") {
    const messageId = session.metadata?.messageId;
    if (!messageId) return { ok: false as const, kind: "unlock" as const };
    const { data: message } = await supabaseAdmin()
      .from("messages")
      .select("price_cents")
      .eq("id", messageId)
      .maybeSingle();
    await recordUnlock({
      messageId,
      chatId,
      priceCents: message?.price_cents ?? session.amount_total ?? 0,
    });
    return { ok: true as const, kind: "unlock" as const, messageId };
  }

  // Tip: post the chat message once (idempotent via stripe session id in content? —
  // better: check if we already posted for this payment_intent).
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (paymentIntentId) {
    const { data: existing } = await supabaseAdmin()
      .from("messages")
      .select("id")
      .eq("chat_id", chatId)
      .eq("sender", "guest")
      .ilike("content", `%${paymentIntentId}%`)
      .maybeSingle();
    if (existing) return { ok: true as const, kind: "tip" as const, messageId: existing.id };
  }

  const amountCents = Number(session.metadata?.amountCents || session.amount_total || 0);
  const caption = session.metadata?.caption || "";
  const { data: chat } = await supabaseAdmin()
    .from("chats")
    .select("owner_id")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) return { ok: false as const, kind: "tip" as const };

  // Append a hidden receipt token so retries don't double-post the tip.
  const base = tipMessageContent(amountCents, caption);
  const content = paymentIntentId ? `${base}\n⌞${paymentIntentId}⌟` : base;

  const db = supabaseAdmin();
  const { data: message, error } = await db
    .from("messages")
    .insert({ chat_id: chatId, sender: "guest", content })
    .select()
    .single();
  if (error || !message) return { ok: false as const, kind: "tip" as const };

  await Promise.all([
    db.from("chats").update({ last_message_at: message.created_at }).eq("id", chatId),
    broadcast(`chat:${chatId}`, "new-message", {
      ...message,
      // Clients strip the receipt token for display via messagePreviewText / render
      content: base,
    }),
    broadcast(`inbox:${chat.owner_id}`, "new-message", { chatId }),
  ]);

  return { ok: true as const, kind: "tip" as const, messageId: message.id as string };
}

/** @deprecated use fulfillCheckout */
export async function fulfillUnlockCheckout(session: Stripe.Checkout.Session) {
  const result = await fulfillCheckout(session);
  return result.ok && result.kind === "unlock";
}
