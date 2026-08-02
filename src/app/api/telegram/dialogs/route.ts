import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import {
  telegramConfigured,
  tgListDialogs,
  tgSessionFor,
} from "@/lib/telegram";

/**
 * Creator's Telegram dialogs (DMs, groups, channels) for the inbox list.
 * Requires a connected account (Settings → Telegram).
 */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!telegramConfigured()) {
    return NextResponse.json(
      { error: "Telegram is not configured on the server" },
      { status: 503 }
    );
  }

  const session = await tgSessionFor(ownerId);
  if (!session) {
    return NextResponse.json(
      { error: "Connect your Telegram account first", disconnected: true },
      { status: 400 }
    );
  }

  try {
    const dialogs = await tgListDialogs({ session, limit: 100 });
    return NextResponse.json({ dialogs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not load Telegram chats";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
