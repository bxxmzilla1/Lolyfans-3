import { supabaseAdmin } from "@/lib/supabase/admin";
import { broadcast } from "@/lib/realtime";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { sendWelcomeMessageIfNeeded } from "@/lib/welcomeMessage";
import type Stripe from "stripe";

/** Advance BlurDrainer layer(s) for this fan (idempotent per PaymentIntent).
 *  count > 1 is used by batched settlements that cover several taps at once. */
export async function recordBlurDrainTap(opts: {
  messageId: string;
  chatId: string;
  layers: number;
  paymentIntentId: string;
  count?: number;
}): Promise<number> {
  const db = supabaseAdmin();
  const { error: ledgerErr } = await db.from("message_blur_taps").insert({
    message_id: opts.messageId,
    chat_id: opts.chatId,
    stripe_payment_intent_id: opts.paymentIntentId,
  });
  if (ledgerErr) {
    const { data } = await db
      .from("message_blur_progress")
      .select("layers_cleared")
      .eq("message_id", opts.messageId)
      .eq("chat_id", opts.chatId)
      .maybeSingle();
    return data?.layers_cleared ?? 0;
  }

  const { data: prev } = await db
    .from("message_blur_progress")
    .select("layers_cleared")
    .eq("message_id", opts.messageId)
    .eq("chat_id", opts.chatId)
    .maybeSingle();
  const next = Math.min(
    opts.layers,
    (prev?.layers_cleared ?? 0) + Math.max(1, opts.count ?? 1)
  );
  await db.from("message_blur_progress").upsert(
    {
      message_id: opts.messageId,
      chat_id: opts.chatId,
      layers_cleared: next,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "message_id,chat_id" }
  );
  await broadcast(`chat:${opts.chatId}`, "blur-drain-progress", {
    messageId: opts.messageId,
    layersCleared: next,
  });
  return next;
}

/** Minimum gap between Pay per Message settlement charges. */
const PPM_SETTLE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Apply a successful Pay per Message charge: debit the billed amount from the
 * chat balance (atomically) and push the new balance to the fan so their
 * Balance popup goes back to $0.00 when nothing else is outstanding.
 * Idempotent per Stripe PaymentIntent via ppm_settlements.
 */
export async function applyPpmSettlement(opts: {
  chatId: string;
  amountCents: number;
  paymentIntentId: string;
}): Promise<number | null> {
  const amount = Math.max(0, Math.round(opts.amountCents));
  if (amount <= 0) return null;
  const db = supabaseAdmin();

  const { error: ledgerErr } = await db.from("ppm_settlements").insert({
    stripe_payment_intent_id: opts.paymentIntentId,
    chat_id: opts.chatId,
    amount_cents: amount,
  });
  // Unique violation = this PaymentIntent already cleared the balance.
  // Any other ledger error (table not migrated yet) → still debit below.
  if (ledgerErr?.code === "23505") {
    const { data } = await db
      .from("chats")
      .select("ppm_balance_cents")
      .eq("id", opts.chatId)
      .maybeSingle();
    const bal = data?.ppm_balance_cents ?? 0;
    await broadcast(`chat:${opts.chatId}`, "ppm-balance", {
      balanceCents: bal,
      declined: false,
    });
    return bal;
  }

  // Prefer the atomic SQL function; fall back to a read/write if it isn't
  // installed yet so settlement still clears the balance.
  let newBal: number;
  const { data: rpcBal, error: rpcErr } = await db.rpc("ppm_debit_balance", {
    p_chat_id: opts.chatId,
    p_amount: amount,
  });
  if (!rpcErr && typeof rpcBal === "number") {
    newBal = rpcBal;
  } else {
    const { data: fresh } = await db
      .from("chats")
      .select("ppm_balance_cents")
      .eq("id", opts.chatId)
      .maybeSingle();
    newBal = Math.max(0, (fresh?.ppm_balance_cents ?? 0) - amount);
    await db
      .from("chats")
      .update({ ppm_balance_cents: newBal, ppm_card_declined: false })
      .eq("id", opts.chatId);
  }

  await broadcast(`chat:${opts.chatId}`, "ppm-balance", {
    balanceCents: newBal,
    declined: false,
  });
  return newBal;
}

/**
 * Pay per Message settlement: charge the chat's accrued message balance to
 * the fan's saved card as ONE PaymentIntent. Called lazily (message sends,
 * wallet polls) — runs at most once an hour unless forced (e.g. right after
 * the fan adds a new card following a decline). A failed charge flips
 * ppm_card_declined, which hides the fan's chat input until a working card
 * is saved. On success the billed amount is deducted so the Balance popup
 * returns to $0.00 (plus anything sent during the charge).
 */
export async function settlePpmBalance(chatId: string, force = false) {
  if (!stripeConfigured()) return;
  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select(
      "id, ppm_balance_cents, ppm_last_settle_at, stripe_customer_id, stripe_payment_method_id"
    )
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) return;

  const balance = chat.ppm_balance_cents ?? 0;
  if (balance <= 0) return;
  const last = chat.ppm_last_settle_at ? Date.parse(chat.ppm_last_settle_at) : 0;
  if (!force && Date.now() - last < PPM_SETTLE_INTERVAL_MS) return;
  if (!chat.stripe_customer_id || !chat.stripe_payment_method_id) return;

  // Claim the settle slot (compare-and-set on the previous timestamp) so two
  // lazy triggers can't double-charge the same balance.
  const claim = db
    .from("chats")
    .update({ ppm_last_settle_at: new Date().toISOString() })
    .eq("id", chatId);
  const { data: claimed } = await (chat.ppm_last_settle_at === null
    ? claim.is("ppm_last_settle_at", null)
    : claim.eq("ppm_last_settle_at", chat.ppm_last_settle_at)
  ).select("id");
  if (!claimed?.length) return;

  try {
    const pi = await stripe().paymentIntents.create({
      amount: balance,
      currency: "usd",
      customer: chat.stripe_customer_id,
      payment_method: chat.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      metadata: {
        chatId,
        kind: "ppm-settle",
        amountCents: String(balance),
      },
      description: "Chat messages",
    });
    if (pi.status !== "succeeded") {
      await db.from("chats").update({ ppm_card_declined: true }).eq("id", chatId);
      await broadcast(`chat:${chatId}`, "ppm-balance", { declined: true });
      return;
    }
    await applyPpmSettlement({
      chatId,
      amountCents: balance,
      paymentIntentId: pi.id,
    });
  } catch {
    await db.from("chats").update({ ppm_card_declined: true }).eq("id", chatId);
    await broadcast(`chat:${chatId}`, "ppm-balance", { declined: true });
  }
}

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
  // Paying is also the fan's "Accept" at the incoming-media gate. Errors are
  // ignored so unlocks keep working before the fan_decision migration runs.
  await db
    .from("messages")
    .update({ fan_decision: "accepted" })
    .eq("id", opts.messageId)
    .is("fan_decision", null);
  await broadcast(`chat:${opts.chatId}`, "message-unlocked", {
    messageId: opts.messageId,
  });
}

/** Format a tip bubble's text content (legacy dollar tips). */
export function tipMessageContent(amountCents: number, caption: string): string {
  const dollars = (amountCents / 100).toFixed(2).replace(/\.00$/, "");
  const head = `💸 Tip · $${dollars}`;
  const body = caption.trim();
  return body ? `${head}\n${body}` : head;
}

/** Format a token tip bubble's text content. */
export function tokenTipMessageContent(tokens: number, caption: string): string {
  const head = `💸 Tip · ${tokens} Tokens`;
  const body = caption.trim();
  return body ? `${head}\n${body}` : head;
}

/**
 * Credit purchased tokens exactly once per Stripe payment (the webhook and
 * the return-URL confirm can both call this). Returns the new balance, or
 * null when this payment was already credited.
 */
export async function creditTokens(opts: {
  chatId: string;
  tokens: number;
  paymentIntentId: string | null;
}): Promise<number | null> {
  const db = supabaseAdmin();
  const { error: ledgerError } = await db.from("token_transactions").insert({
    chat_id: opts.chatId,
    amount: opts.tokens,
    kind: "topup",
    stripe_payment_intent_id: opts.paymentIntentId,
  });
  // Unique payment-intent index: a duplicate means it was already credited.
  if (ledgerError) return null;

  const { data: balance, error } = await db.rpc("credit_tokens", {
    p_chat_id: opts.chatId,
    p_amount: opts.tokens,
  });
  if (error) throw new Error(error.message);
  return typeof balance === "number" && balance >= 0 ? balance : null;
}

/**
 * Spend tokens atomically. Returns the new balance, or null when the wallet
 * doesn't cover the amount.
 */
export async function spendTokens(opts: {
  chatId: string;
  tokens: number;
  kind: "unlock" | "tip";
  messageId?: string | null;
}): Promise<number | null> {
  const db = supabaseAdmin();
  const { data: balance, error } = await db.rpc("spend_tokens", {
    p_chat_id: opts.chatId,
    p_amount: opts.tokens,
  });
  if (error) throw new Error(error.message);
  if (typeof balance !== "number" || balance < 0) return null;

  await db.from("token_transactions").insert({
    chat_id: opts.chatId,
    amount: -opts.tokens,
    kind: opts.kind,
    message_id: opts.messageId ?? null,
  });
  return balance;
}

/** Current token balance of a fan chat. */
export async function tokenBalance(chatId: string): Promise<number> {
  const { data } = await supabaseAdmin()
    .from("chats")
    .select("token_balance")
    .eq("id", chatId)
    .maybeSingle();
  return (data?.token_balance as number | undefined) ?? 0;
}

/** Persist a tip as a guest chat message and notify both sides. */
export async function postTipMessage(opts: {
  chatId: string;
  content: string;
  ownerId: string;
}) {
  const db = supabaseAdmin();
  const content = opts.content;
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
    broadcast(`inbox:${opts.ownerId}`, "new-message", {
      chatId: opts.chatId,
      content: message.content ?? null,
      media_type: message.media_type ?? null,
      created_at: message.created_at,
      sender: message.sender,
    }),
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
  await sendWelcomeMessageIfNeeded(opts.chatId, opts.ownerId);
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
    await sendWelcomeMessageIfNeeded(chatId, ownerId);
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
  if (
    !chatId ||
    (kind !== "unlock" && kind !== "tip" && kind !== "subscription" && kind !== "topup")
  ) {
    return { ok: false as const, kind: null };
  }

  // Token top-up: save the card for one-tap next time, then credit the pack
  // (idempotent per payment intent).
  if (kind === "topup") {
    const tokens = Math.max(0, Math.round(Number(session.metadata?.tokens || 0)));
    if (!tokens) return { ok: false as const, kind: "topup" as const };
    const { customerId, paymentMethodId } = await paymentMethodFromSession(session);
    await saveStripePaymentMethod(chatId, customerId, paymentMethodId);
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
    await creditTokens({ chatId, tokens, paymentIntentId });
    // A claimed creator-sent offer is single-use: clear it once paid.
    if (session.metadata?.customOffer === "1") {
      await supabaseAdmin().from("chats").update({ custom_offer: null }).eq("id", chatId);
    }
    return { ok: true as const, kind: "topup" as const, messageId: null };
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
    broadcast(`inbox:${chat.owner_id}`, "new-message", {
      chatId,
      content: base,
      media_type: null,
      created_at: message.created_at,
      sender: "guest",
    }),
  ]);

  return { ok: true as const, kind: "tip" as const, messageId: message.id as string };
}

/** @deprecated use fulfillCheckout */
export async function fulfillUnlockCheckout(session: Stripe.Checkout.Session) {
  const result = await fulfillCheckout(session);
  return result.ok && result.kind === "unlock";
}
