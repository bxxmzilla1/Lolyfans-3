import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import {
  telegramConfigured,
  tgGetMessages,
  tgSendText,
  tgSessionFor,
} from "@/lib/telegram";

/**
 * GET: recent messages in a Telegram dialog.
 * POST: send a plain text reply into that dialog.
 */
export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const peer = req.nextUrl.searchParams.get("peer")?.trim();
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
    const messages = await tgGetMessages({ session, peer, limit: 50 });
    return NextResponse.json({ messages });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not load messages";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const peer = String(body.peer || "").trim();
  const text = String(body.text || "").trim();
  if (!peer) return NextResponse.json({ error: "peer required" }, { status: 400 });
  if (!text) return NextResponse.json({ error: "Message is empty" }, { status: 400 });
  if (text.length > 4000) {
    return NextResponse.json({ error: "Message is too long" }, { status: 400 });
  }

  const session = await tgSessionFor(ownerId);
  if (!session) {
    return NextResponse.json(
      { error: "Connect your Telegram account first", disconnected: true },
      { status: 400 }
    );
  }

  try {
    await tgSendText({ session, peer, text });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not send";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
