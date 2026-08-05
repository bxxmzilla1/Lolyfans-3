import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { broadcast } from "@/lib/realtime";
import { guestCall } from "@/lib/voiceCall";

// Long-polls for the chatbot's answer — keep headroom over the wait budget.
export const maxDuration = 60;

/** How long we wait for the chatbot before giving the turn up (ms). */
const REPLY_WAIT_MS = 25_000;
const POLL_EVERY_MS = 300;

/**
 * One voice-call turn: the fan's speech transcript goes in, the chatbot's
 * reply text comes out. The turn is broadcast on the owner's inbox topic
 * ("call-turn") so Orion answers it immediately via /api/external/calls;
 * this request long-polls the turn row until that answer lands, so the
 * whole exchange is a single round trip for the browser.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const callId = String(body.callId || "").trim();
  const text = String(body.text || "").trim().slice(0, 1000);
  if (!callId || !text) {
    return NextResponse.json({ error: "callId and text required" }, { status: 400 });
  }

  const call = await guestCall(req.headers, callId);
  if (!call) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (call.status !== "active") {
    return NextResponse.json({ error: "Call has ended" }, { status: 409 });
  }

  const db = supabaseAdmin();
  const { data: turn, error } = await db
    .from("voice_call_turns")
    .insert({ call_id: call.id, text })
    .select("id")
    .single();
  if (error || !turn) {
    return NextResponse.json({ error: "Could not send" }, { status: 500 });
  }

  await Promise.all([
    broadcast(`inbox:${call.owner_id}`, "call-turn", {
      callId: call.id,
      turnId: turn.id,
      chatId: call.chat_id,
      text,
    }),
    db
      .from("voice_calls")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", call.id),
  ]);

  // Wait for Orion's answer.
  const deadline = Date.now() + REPLY_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
    const { data: row } = await db
      .from("voice_call_turns")
      .select("reply")
      .eq("id", turn.id)
      .maybeSingle();
    const reply = (row?.reply as string | null) ?? null;
    if (reply) {
      return NextResponse.json({ turnId: turn.id, reply });
    }
  }

  // No answer in time — the fan keeps talking; Orion may still answer late
  // (the reply would then ride along on the next turn's history).
  return NextResponse.json({ turnId: turn.id, reply: null });
}
