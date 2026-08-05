import { NextRequest, NextResponse } from "next/server";
import { broadcast } from "@/lib/realtime";
import { endCall, guestCall } from "@/lib/voiceCall";

/**
 * Hang up. Also hit by sendBeacon when the fan closes the tab, so the call
 * row never stays "active" forever.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const callId = String(body.callId || "").trim();
  if (!callId) return NextResponse.json({ error: "callId required" }, { status: 400 });

  const call = await guestCall(req.headers, callId);
  if (!call) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await endCall(call);
  await broadcast(`inbox:${call.owner_id}`, "call-ended", {
    callId: call.id,
    chatId: call.chat_id,
    minutes: call.minutes_charged,
  });

  return NextResponse.json({ ok: true, minutes: call.minutes_charged });
}
