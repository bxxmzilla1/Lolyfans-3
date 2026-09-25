import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { guestChats } from "@/lib/guest";
import { packById, packTotalTokens } from "@/lib/tokens";
import { parseCouponMessage } from "@/lib/coupon";
import {
  chatSubscription,
  ownerSubPlan,
  subscriptionChargeCents,
} from "@/lib/subscriptionAccess";
import {
  USDC_MINT,
  centsToMicroUsdc,
  cryptoConfigured,
  cryptoReceiver,
  newReference,
} from "@/lib/solana";

type Priced = {
  chatId: string;
  kind: "topup" | "coupon" | "subscription";
  packId: string;
  tokens: number;
  priceCents: number;
  ownerId?: string;
  messageId?: string;
};

type Resolved = Priced | { error: string; status: number };

async function resolve(req: NextRequest, body: Record<string, unknown>): Promise<Resolved> {
  const db = supabaseAdmin();

  // Paid-profile subscription period (or lifetime access).
  if (typeof body.subscribeOwnerId === "string" && body.subscribeOwnerId) {
    const ownerId = body.subscribeOwnerId;
    const chat = (await guestChats(req.headers)).find((c) => c.owner_id === ownerId);
    if (!chat) return { error: "Sign up with Phantom first", status: 401 };
    const plan = await ownerSubPlan(ownerId);
    if (plan.priceCents <= 0) return { error: "This profile is free", status: 400 };
    const priceCents = subscriptionChargeCents(plan, await chatSubscription(chat.id, ownerId));
    return {
      chatId: chat.id,
      kind: "subscription",
      packId: `sub:${plan.interval}`,
      tokens: 0,
      priceCents,
      ownerId,
    };
  }

  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  if (!chatId) return { error: "chatId required", status: 400 };
  if (!(await guestOwnsChat(req.headers, chatId))) {
    return { error: "Unauthorized", status: 401 };
  }

  // Creator-sent coupon bubble: one-time pack priced from the message body.
  if (typeof body.couponMessageId === "string" && body.couponMessageId) {
    const { data: msg } = await db
      .from("messages")
      .select("id, chat_id, sender, content")
      .eq("id", body.couponMessageId)
      .eq("chat_id", chatId)
      .maybeSingle();
    const coupon = parseCouponMessage(msg?.content);
    if (!msg || msg.sender !== "owner" || !coupon) {
      return { error: "Coupon not found", status: 404 };
    }
    const { count: redeemed } = await db
      .from("token_transactions")
      .select("id", { count: "exact", head: true })
      .eq("chat_id", chatId)
      .eq("message_id", msg.id)
      .eq("kind", "topup");
    if ((redeemed ?? 0) > 0) {
      return { error: "This coupon has already been used", status: 410 };
    }
    return {
      chatId,
      kind: "coupon",
      packId: "coupon",
      tokens: coupon.tokens,
      priceCents: coupon.priceCents,
      messageId: msg.id,
    };
  }

  const pack = packById(String(body.packId || ""));
  if (!pack) return { error: "Unknown pack", status: 400 };
  return {
    chatId,
    kind: "topup",
    packId: pack.id,
    tokens: packTotalTokens(pack),
    priceCents: pack.priceCents,
  };
}

/**
 * Start a USDC payment: records the attempt and hands the browser everything
 * it needs to build the Phantom transaction (receiver, amount, reference).
 * Body: { chatId, packId } | { chatId, couponMessageId } | { subscribeOwnerId }.
 */
export async function POST(req: NextRequest) {
  if (!cryptoConfigured()) {
    return NextResponse.json({ error: "Crypto payments are not available" }, { status: 503 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const priced = await resolve(req, body);
  if ("error" in priced) {
    return NextResponse.json({ error: priced.error }, { status: priced.status });
  }
  if (priced.priceCents <= 0) {
    return NextResponse.json({ error: "Nothing to pay" }, { status: 400 });
  }

  const amountMicro = centsToMicroUsdc(priced.priceCents);
  const reference = newReference();
  const { error } = await supabaseAdmin().from("crypto_topups").insert({
    chat_id: priced.chatId,
    kind: priced.kind,
    pack_id: priced.packId,
    tokens: priced.tokens,
    amount_micro: amountMicro,
    reference,
    owner_id: priced.ownerId ?? null,
    message_id: priced.messageId ?? null,
  });
  if (error) {
    const msg = /crypto_topups|kind|owner_id|message_id/i.test(error.message)
      ? "Run supabase/migration-phantom-only.sql to enable crypto payments"
      : error.message;
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({
    reference,
    receiver: cryptoReceiver(),
    mint: USDC_MINT,
    amountMicro,
    amountCents: priced.priceCents,
    tokens: priced.tokens,
    packId: priced.packId,
    kind: priced.kind,
  });
}
