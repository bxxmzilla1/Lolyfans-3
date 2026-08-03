import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import {
  telegramConfigured,
  tgSessionFor,
  tgSendVoiceFromBuffer,
} from "@/lib/telegram";

// Opus conversion + Telegram upload can take a while for long notes.
export const maxDuration = 300;

/**
 * Send a generated voice note (base64 audio from /api/voice/generate) into a
 * Telegram chat as a real voice message (round bubble with waveform).
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const peer = typeof body.peer === "string" ? body.peer.trim() : "";
  const audioB64 = typeof body.audioB64 === "string" ? body.audioB64 : "";
  const replyToId =
    typeof body.replyToId === "number" && body.replyToId > 0
      ? body.replyToId
      : null;
  if (!peer || !audioB64) {
    return NextResponse.json(
      { error: "peer and audioB64 required" },
      { status: 400 }
    );
  }

  if (!telegramConfigured()) {
    return NextResponse.json(
      { error: "Telegram is not configured" },
      { status: 503 }
    );
  }
  const session = await tgSessionFor(ownerId);
  if (!session) {
    return NextResponse.json({ error: "Connect Telegram first" }, { status: 400 });
  }

  const audio = Buffer.from(audioB64, "base64");
  if (!audio.length) {
    return NextResponse.json({ error: "Empty audio" }, { status: 400 });
  }
  if (audio.length > 15 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Voice note is too large" },
      { status: 400 }
    );
  }

  try {
    await tgSendVoiceFromBuffer({ session, peer, audio, replyToId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Could not send the voice note";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
