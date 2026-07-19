import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/wallet";
import { createInvoice, nowpaymentsConfigured } from "@/lib/nowpayments";
import { requestOrigin } from "@/lib/smsNotify";

/**
 * Start a wallet top-up: create a NOWPayments invoice tied to this fan's chat
 * and hand back the hosted checkout URL. The IPN callback credits the balance
 * once the payment settles.
 */
export async function POST(req: NextRequest) {
  if (!nowpaymentsConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { chatId, amountCents } = await req.json();
  if (!chatId || !Number.isFinite(amountCents)) {
    return NextResponse.json({ error: "chatId and amountCents required" }, { status: 400 });
  }
  // Clamp between $1 and $2000 to keep obviously-wrong amounts out.
  const amount = Math.round(Number(amountCents));
  if (amount < 100 || amount > 200_000) {
    return NextResponse.json({ error: "Amount must be between $1 and $2000" }, { status: 400 });
  }

  if (!(await guestOwnsChat(req.headers, chatId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("owner_id")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const { data: topup, error } = await db
    .from("wallet_topups")
    .insert({ chat_id: chatId, owner_id: chat.owner_id, amount_cents: amount })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const origin = requestOrigin(req.headers);
  const invoice = await createInvoice({
    amountCents: amount,
    orderId: topup.id,
    orderDescription: `Wallet top-up ($${(amount / 100).toFixed(2)})`,
    ipnCallbackUrl: `${origin}/api/wallet/ipn`,
    successUrl: `${origin}/chat`,
    cancelUrl: `${origin}/chat`,
  });
  if (!invoice) {
    await db.from("wallet_topups").update({ status: "error" }).eq("id", topup.id);
    return NextResponse.json({ error: "Could not create invoice" }, { status: 502 });
  }

  await db.from("wallet_topups").update({ invoice_id: invoice.invoiceId }).eq("id", topup.id);
  return NextResponse.json({ invoiceUrl: invoice.invoiceUrl });
}
