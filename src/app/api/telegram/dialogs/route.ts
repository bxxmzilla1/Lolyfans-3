import { NextResponse, after } from "next/server";
import { getOwnerId } from "@/lib/session";
import {
  telegramConfigured,
  tgListDialogs,
  tgSessionFor,
} from "@/lib/telegram";
import { chargeReactionUnlocks } from "@/lib/telegramUnlock";

// The inbox polls this route every ~20s while the creator has the app open —
// that heartbeat also drives the reaction-to-pay scan, throttled per owner.
const lastReactionScan = new Map<string, number>();
const REACTION_SCAN_MS = 25_000;

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

    // Fans with a saved card can pay a PPV by reacting to (double-tapping)
    // the teaser message — check for new reactions after responding.
    const now = Date.now();
    if (now - (lastReactionScan.get(ownerId) ?? 0) > REACTION_SCAN_MS) {
      lastReactionScan.set(ownerId, now);
      after(async () => {
        try {
          await chargeReactionUnlocks(ownerId, session);
        } catch {
          // best-effort — next poll retries
        }
      });
    }

    return NextResponse.json({ dialogs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not load Telegram chats";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
