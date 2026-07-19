import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyIpnSignature } from "@/lib/nowpayments";
import { broadcast } from "@/lib/realtime";

/**
 * NOWPayments IPN callback. Fired whenever a top-up payment changes status;
 * when it reaches `finished` we credit the fan's wallet exactly once. The body
 * is signature-verified so nobody can forge a credit.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-nowpayments-sig");
  if (!verifyIpnSignature(raw, signature)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  const payload = JSON.parse(raw) as {
    payment_status?: string;
    order_id?: string;
    payment_id?: string | number;
  };
  const status = payload.payment_status;
  const orderId = payload.order_id;
  if (!orderId) return NextResponse.json({ ok: true });

  const db = supabaseAdmin();
  const { data: topup } = await db
    .from("wallet_topups")
    .select("id, chat_id, amount_cents, credited_at")
    .eq("id", orderId)
    .maybeSingle();
  if (!topup) return NextResponse.json({ ok: true });

  const patch: Record<string, unknown> = { status: status ?? "unknown" };
  if (payload.payment_id != null) patch.payment_id = String(payload.payment_id);

  // Credit only on the terminal success status, and only once.
  if (status === "finished" && !topup.credited_at) {
    const { data: chat } = await db
      .from("chats")
      .select("wallet_balance_cents, owner_id")
      .eq("id", topup.chat_id)
      .maybeSingle();
    if (chat) {
      const next = (chat.wallet_balance_cents ?? 0) + topup.amount_cents;
      await db.from("chats").update({ wallet_balance_cents: next }).eq("id", topup.chat_id);
      patch.credited_at = new Date().toISOString();
      await broadcast(`wallet:${topup.chat_id}`, "balance", { balanceCents: next });
    }
  }

  await db.from("wallet_topups").update(patch).eq("id", topup.id);
  return NextResponse.json({ ok: true });
}
