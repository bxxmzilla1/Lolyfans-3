import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { telegramConfigured, tgSessionFor, tgSetPinned } from "@/lib/telegram";

/** Pin (or unpin) a Telegram dialog — keeps it at the top of the inbox. */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const peer = String(body.peer || "").trim();
  const pinned = body.pinned !== false;
  if (!peer) return NextResponse.json({ error: "peer required" }, { status: 400 });

  if (!telegramConfigured()) {
    return NextResponse.json({ error: "Telegram is not configured" }, { status: 503 });
  }
  const session = await tgSessionFor(ownerId);
  if (!session) {
    return NextResponse.json(
      { error: "Connect your Telegram account first", disconnected: true },
      { status: 400 }
    );
  }

  try {
    await tgSetPinned({ session, peer, pinned });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not pin";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
