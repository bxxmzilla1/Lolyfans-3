import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { broadcast } from "@/lib/realtime";
import {
  CALL_PRICE_CENTS_PER_MIN,
  chargeCallMinute,
  creatorVoiceId,
  type VoiceCall,
} from "@/lib/voiceCall";

/**
 * Fan starts a voice call with the creator's chatbot. Requires a saved card
 * (calls are $1/min, charged per minute off-session — the first minute is
 * charged right here). Broadcasts "call-started" on the owner's inbox topic
 * so the connected chatbot (Orion) can pull chat context before turn one.
 */
export async function POST() {
  const chatId = await getGuestChatId();
  if (!chatId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id, owner_id, stripe_customer_id, stripe_payment_method_id")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  if (!(await creatorVoiceId(chat.owner_id))) {
    return NextResponse.json(
      { error: "Voice calls aren't available on this profile yet" },
      { status: 400 }
    );
  }

  if (!chat.stripe_customer_id || !chat.stripe_payment_method_id) {
    return NextResponse.json(
      {
        error:
          "Calls need a saved card. Unlock any paid content or top up once — your card is saved automatically.",
        needCard: true,
      },
      { status: 402 }
    );
  }

  // One active call per chat — hang up a stale one first (e.g. closed tab).
  await db
    .from("voice_calls")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("chat_id", chatId)
    .eq("status", "active");

  const { data: created, error } = await db
    .from("voice_calls")
    .insert({
      owner_id: chat.owner_id,
      chat_id: chatId,
      price_cents_per_min: CALL_PRICE_CENTS_PER_MIN,
    })
    .select("*")
    .single();
  if (error || !created) {
    return NextResponse.json(
      { error: "Could not start the call (run the latest DB migration?)" },
      { status: 500 }
    );
  }
  const call = created as VoiceCall;

  // First minute is paid up front; a declined card means no call.
  if (!(await chargeCallMinute(call))) {
    await db
      .from("voice_calls")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", call.id);
    return NextResponse.json(
      { error: "Your card was declined — the call could not start.", needCard: true },
      { status: 402 }
    );
  }

  await broadcast(`inbox:${chat.owner_id}`, "call-started", {
    callId: call.id,
    chatId,
  });

  return NextResponse.json({
    callId: call.id,
    pricePerMinCents: call.price_cents_per_min,
  });
}
