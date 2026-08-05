import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  createToken,
  GUEST_COOKIE,
  cookieOptions,
} from "@/lib/session";
import { saveStripePaymentMethod } from "@/lib/payments";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { appOrigin, ownerIdForCpmCode } from "@/lib/cpm";
import { broadcast } from "@/lib/realtime";

/**
 * Bridge from the pay-link domain back to Lolyfans after a successful card
 * payment. Verifies the PaymentIntent, saves the card, reveals the chat,
 * sets the guest cookie on the *app* domain, and redirects to /chat.
 *
 * (Cookies set on telegrampay.co wouldn't be visible on lolyfans.com.)
 */
export async function GET(req: NextRequest) {
  const chatUrl = `${appOrigin()}/chat`;
  if (!stripeConfigured()) {
    return NextResponse.redirect(appOrigin());
  }

  const code = (req.nextUrl.searchParams.get("code") || "").trim();
  const chatId = (req.nextUrl.searchParams.get("chatId") || "").trim();
  const paymentIntentId = (
    req.nextUrl.searchParams.get("paymentIntentId") || ""
  ).trim();
  if (!code || !chatId || !paymentIntentId) {
    return NextResponse.redirect(appOrigin());
  }

  const ownerId = await ownerIdForCpmCode(code);
  if (!ownerId) return NextResponse.redirect(appOrigin());

  const pi = await stripe()
    .paymentIntents.retrieve(paymentIntentId, { expand: ["payment_method"] })
    .catch(() => null);
  if (
    !pi ||
    pi.metadata?.kind !== "cpm-start" ||
    pi.metadata?.chatId !== chatId ||
    pi.status !== "succeeded"
  ) {
    return NextResponse.redirect(`${appOrigin()}/m/${encodeURIComponent(code)}`);
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id, owner_id")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat || chat.owner_id !== ownerId) {
    return NextResponse.redirect(appOrigin());
  }

  const paymentMethodId =
    typeof pi.payment_method === "string"
      ? pi.payment_method
      : pi.payment_method?.id ?? null;
  const customerId = typeof pi.customer === "string" ? pi.customer : null;
  await saveStripePaymentMethod(chatId, customerId, paymentMethodId);

  // The name typed into the card form doubles as the fan's display name —
  // there is no separate name input on the CPM landing page.
  const cardholderName =
    typeof pi.payment_method === "object" && pi.payment_method
      ? (pi.payment_method.billing_details?.name || "").trim().slice(0, 40)
      : "";
  await db
    .from("chats")
    .update({
      pending: false,
      ...(cardholderName ? { guest_name: cardholderName } : {}),
    })
    .eq("id", chatId);

  // Session with first minute already paid by this PI — don't charge again.
  const { data: live } = await db
    .from("cpm_sessions")
    .select("id")
    .eq("chat_id", chatId)
    .eq("status", "active")
    .maybeSingle();
  if (!live) {
    await db.from("cpm_sessions").insert({
      chat_id: chatId,
      owner_id: ownerId,
      minutes_charged: 1,
    });
  }

  await broadcast(`inbox:${ownerId}`, "new-chat", { chatId });

  const res = NextResponse.redirect(chatUrl);
  res.cookies.set(GUEST_COOKIE, createToken({ chatId }), cookieOptions);
  return res;
}
