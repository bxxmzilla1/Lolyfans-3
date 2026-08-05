import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { chargeChatDollars } from "@/lib/payments";

/** Flat per-minute price for chatbot voice calls. */
export const CALL_PRICE_CENTS_PER_MIN = 100;

export type VoiceCall = {
  id: string;
  owner_id: string;
  chat_id: string;
  status: "active" | "ended";
  price_cents_per_min: number;
  minutes_charged: number;
  started_at: string;
  last_active_at: string;
  ended_at: string | null;
};

export async function getCall(id: string): Promise<VoiceCall | null> {
  if (!id) return null;
  const { data } = await supabaseAdmin()
    .from("voice_calls")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as VoiceCall | null) ?? null;
}

/** The call, only if the current guest owns the chat behind it. */
export async function guestCall(
  requestHeaders: Headers,
  callId: string
): Promise<VoiceCall | null> {
  const call = await getCall(callId);
  if (!call) return null;
  const owns = await guestOwnsChat(requestHeaders, call.chat_id);
  return owns ? call : null;
}

/**
 * Charge one more minute of an active call on the fan's saved card.
 * Returns true when paid; false means no card / declined (end the call).
 */
export async function chargeCallMinute(call: VoiceCall): Promise<boolean> {
  const result = await chargeChatDollars({
    chatId: call.chat_id,
    amountCents: call.price_cents_per_min,
    kind: "voice-call",
    description: "Voice call (per minute)",
    metadata: { callId: call.id },
  }).catch(() => null);
  // A clientSecret result means there's no chargeable saved card — calls
  // never open a card wizard mid-conversation, so that counts as failure.
  if (!result || !("paid" in result)) return false;

  await supabaseAdmin()
    .from("voice_calls")
    .update({
      minutes_charged: call.minutes_charged + 1,
      last_active_at: new Date().toISOString(),
    })
    .eq("id", call.id);
  return true;
}

/** ElevenLabs voice id the creator saved in Settings ("" when unset). */
export async function creatorVoiceId(ownerId: string): Promise<string> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(ownerId);
  return String(
    (data?.user?.user_metadata as { eleven_voice_id?: string } | undefined)
      ?.eleven_voice_id || ""
  ).trim();
}

export async function endCall(call: VoiceCall): Promise<void> {
  if (call.status === "ended") return;
  await supabaseAdmin()
    .from("voice_calls")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", call.id)
    .eq("status", "active");
}
