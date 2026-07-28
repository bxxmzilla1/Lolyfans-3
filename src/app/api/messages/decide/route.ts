import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { broadcast } from "@/lib/realtime";

/**
 * Incoming-media gate: the fan accepts or rejects a creator photo/video that
 * arrived full screen. Accept shows it in the chat; reject removes it for
 * them permanently. Priced locked media can't be accepted here — accepting
 * it goes through /api/payments/unlock (the payment IS the acceptance).
 */
export async function POST(req: NextRequest) {
  const { messageId, decision } = await req.json();
  if (!messageId || (decision !== "accept" && decision !== "reject")) {
    return NextResponse.json(
      { error: "messageId and decision (accept|reject) required" },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const { data: message } = await db
    .from("messages")
    .select("id, chat_id, sender, media_items, media_type, price_cents, locked, fan_decision")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await guestOwnsChat(req.headers, message.chat_id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (message.sender !== "owner") {
    return NextResponse.json({ error: "Not an incoming message" }, { status: 400 });
  }
  // Already decided — idempotent, nothing to change.
  if (message.fan_decision) {
    return NextResponse.json({ ok: true, decision: message.fan_decision });
  }

  if (decision === "accept" && message.locked && (message.price_cents ?? 0) > 0) {
    // Paying unlocks AND accepts (recordUnlock marks the decision), so a
    // plain accept would hand out priced content for free.
    const { data: paid } = await db
      .from("message_unlocks")
      .select("message_id")
      .eq("message_id", messageId)
      .eq("chat_id", message.chat_id)
      .maybeSingle();
    if (!paid) {
      return NextResponse.json({ error: "This content must be purchased" }, { status: 402 });
    }
  }

  const fanDecision = decision === "accept" ? "accepted" : "rejected";
  const { data: updated, error } = await db
    .from("messages")
    .update({ fan_decision: fanDecision })
    .eq("id", messageId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Other open tabs of the fan (and the creator's view) stay in sync.
  await broadcast(`chat:${message.chat_id}`, "update-message", updated);

  return NextResponse.json({ ok: true, decision: fanDecision });
}
