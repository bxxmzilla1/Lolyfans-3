import { supabaseAdmin } from "@/lib/supabase/admin";
import { broadcast } from "@/lib/realtime";

/** Advance BlurDrainer layer(s) for this fan (idempotent per tap id).
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

/** Format a token tip bubble's text content. */
export function tokenTipMessageContent(tokens: number, caption: string): string {
  const head = `💸 Tip · ${tokens} Tokens`;
  const body = caption.trim();
  return body ? `${head}\n${body}` : head;
}

/**
 * Credit purchased tokens exactly once per payment (keyed by
 * `sol:<signature>`). Returns the new balance, or null when this payment was
 * already credited.
 */
export async function creditTokens(opts: {
  chatId: string;
  tokens: number;
  paymentIntentId: string | null;
  /** Optional: coupon message id — marks that coupon as redeemed. */
  messageId?: string | null;
}): Promise<number | null> {
  const db = supabaseAdmin();
  const { error: ledgerError } = await db.from("token_transactions").insert({
    chat_id: opts.chatId,
    amount: opts.tokens,
    kind: "topup",
    stripe_payment_intent_id: opts.paymentIntentId,
    ...(opts.messageId ? { message_id: opts.messageId } : {}),
  });
  // Unique payment index: a duplicate means it was already credited.
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
  kind: "unlock" | "tip" | "call";
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
 * Paid-profile sign-ups created `pending` (hidden from the creator's chat
 * list) are revealed once they subscribe: flip the flag and ping the inbox.
 */
export async function revealPendingChat(chatId: string, ownerId: string) {
  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("pending")
    .eq("id", chatId)
    .maybeSingle();
  // Column missing (migration not run) or already visible: nothing to do.
  if (!chat || !(chat as { pending?: boolean }).pending) return;
  await db.from("chats").update({ pending: false }).eq("id", chatId);
  await broadcast(`inbox:${ownerId}`, "new-chat", { chatId });
}
