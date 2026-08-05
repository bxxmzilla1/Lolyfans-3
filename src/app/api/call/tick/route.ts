import { NextRequest, NextResponse } from "next/server";
import { chargeCallMinute, endCall, guestCall } from "@/lib/voiceCall";

/**
 * Per-minute billing heartbeat: the call page posts here every 60 seconds
 * while the call is live. Each tick charges one more minute on the fan's
 * saved card; a failed charge ends the call immediately.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const callId = String(body.callId || "").trim();
  if (!callId) return NextResponse.json({ error: "callId required" }, { status: 400 });

  const call = await guestCall(req.headers, callId);
  if (!call) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (call.status !== "active") {
    return NextResponse.json({ error: "Call has ended" }, { status: 409 });
  }

  if (!(await chargeCallMinute(call))) {
    await endCall(call);
    return NextResponse.json(
      { error: "Your card was declined — the call has ended." },
      { status: 402 }
    );
  }

  return NextResponse.json({
    ok: true,
    minutesCharged: call.minutes_charged + 1,
  });
}
