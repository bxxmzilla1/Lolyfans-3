import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { spendTokens } from "@/lib/payments";
import { tokensForCents } from "@/lib/tokens";

/** Flat per-minute price for chatbot voice calls. */
export const CALL_PRICE_CENTS_PER_MIN = 100;
/** …in wallet Tokens. */
export const CALL_TOKENS_PER_MIN = tokensForCents(CALL_PRICE_CENTS_PER_MIN);

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
 * Pay one more minute of an active call from the fan's token wallet.
 * Returns true when paid; false means the wallet is empty (end the call).
 */
export async function chargeCallMinute(call: VoiceCall): Promise<boolean> {
  const balance = await spendTokens({
    chatId: call.chat_id,
    tokens: tokensForCents(call.price_cents_per_min),
    kind: "call",
  }).catch(() => null);
  if (balance === null) return false;

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
