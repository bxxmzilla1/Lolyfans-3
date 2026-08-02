import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { telegramConfigured, tgSessionFor, tgSetArchived } from "@/lib/telegram";

/** Archive (or unarchive) a Telegram dialog — it disappears from the inbox. */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const peer = String(body.peer || "").trim();
  const archived = body.archived !== false;
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
    await tgSetArchived({ session, peer, archived });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not archive";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
