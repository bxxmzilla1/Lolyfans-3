import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ownerFromApiKey } from "@/lib/apiKey";
import { broadcast } from "@/lib/realtime";

// Allow the Orion desktop app (or any external client) to call this.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Voice calls for the connected chatbot (Orion).
 *
 * Fans call the chatbot from the web; everything they say becomes a "turn"
 * that Orion answers with text (Lolyfans speaks it with ElevenLabs). Orion
 * hears about new turns instantly via the `inbox:<ownerId>` broadcast
 * channel it already listens to (events "call-started", "call-turn",
 * "call-ended") — this endpoint is the pull + answer side:
 *
 *   GET  → active calls with their full turn history and unanswered turns.
 *   POST { turnId, reply } → answer one turn. Speed matters: the fan is on
 *          the line, and turns time out after ~25s.
 */
export async function GET(req: NextRequest) {
  const ownerId = await ownerFromApiKey(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS });
  }

  const db = supabaseAdmin();
  const { data: calls } = await db
    .from("voice_calls")
    .select("id, chat_id, status, started_at, minutes_charged")
    .eq("owner_id", ownerId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(10);
  if (!calls?.length) return NextResponse.json({ calls: [] }, { headers: CORS });

  const callIds = calls.map((c) => c.id as string);
  const chatIds = [...new Set(calls.map((c) => c.chat_id as string))];
  const [{ data: turns }, { data: chats }] = await Promise.all([
    db
      .from("voice_call_turns")
      .select("id, call_id, text, reply, created_at, answered_at")
      .in("call_id", callIds)
      .order("created_at", { ascending: true }),
    db.from("chats").select("id, guest_name, custom_name").in("id", chatIds),
  ]);
  const nameByChat = new Map(
    (chats ?? []).map((c) => [
      c.id as string,
      (c.custom_name as string | null) || (c.guest_name as string) || "Fan",
    ])
  );

  const shaped = calls.map((call) => {
    const callTurns = (turns ?? []).filter((t) => t.call_id === call.id);
    return {
      id: call.id,
      chatId: call.chat_id,
      fanName: nameByChat.get(call.chat_id as string) ?? "Fan",
      startedAt: call.started_at,
      minutes: call.minutes_charged,
      // Full transcript so Orion always has the conversation context.
      turns: callTurns.map((t) => ({
        turnId: t.id,
        fan: t.text,
        reply: t.reply,
        at: t.created_at,
      })),
      // What still needs an answer, oldest first.
      pending: callTurns
        .filter((t) => !t.reply)
        .map((t) => ({ turnId: t.id, text: t.text, at: t.created_at })),
    };
  });

  return NextResponse.json({ calls: shaped }, { headers: CORS });
}

export async function POST(req: NextRequest) {
  const ownerId = await ownerFromApiKey(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS });
  }

  const body = await req.json().catch(() => ({}));
  const turnId = String(body.turnId || "").trim();
  const reply = String(body.reply || "").trim().slice(0, 2000);
  if (!turnId || !reply) {
    return NextResponse.json(
      { error: "turnId and reply required" },
      { status: 400, headers: CORS }
    );
  }

  const db = supabaseAdmin();
  const { data: turn } = await db
    .from("voice_call_turns")
    .select("id, call_id, reply")
    .eq("id", turnId)
    .maybeSingle();
  if (!turn) {
    return NextResponse.json({ error: "Turn not found" }, { status: 404, headers: CORS });
  }
  const { data: call } = await db
    .from("voice_calls")
    .select("id, owner_id")
    .eq("id", turn.call_id)
    .maybeSingle();
  if (!call || call.owner_id !== ownerId) {
    return NextResponse.json({ error: "Turn not found" }, { status: 404, headers: CORS });
  }
  if (turn.reply) {
    return NextResponse.json({ ok: true, alreadyAnswered: true }, { headers: CORS });
  }

  await db
    .from("voice_call_turns")
    .update({ reply, answered_at: new Date().toISOString() })
    .eq("id", turnId)
    .is("reply", null);

  // Low-latency extra for the fan's browser (the turn long-poll also sees it).
  await broadcast(`call:${call.id}`, "reply", { turnId, reply });

  return NextResponse.json({ ok: true }, { headers: CORS });
}
