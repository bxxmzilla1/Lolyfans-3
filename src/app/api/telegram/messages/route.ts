import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  telegramConfigured,
  tgGetMessages,
  tgSendText,
  tgSessionFor,
} from "@/lib/telegram";

/**
 * PPV state per teaser message id, so the creator's chat can color bought
 * PPV bubbles green. User-account message ids are global across DMs, so an
 * id match is exact there; channels have their own id space and need the
 * peer to match too.
 */
async function ppvByMessageId(
  ownerId: string,
  peer: string,
  messageIds: number[]
): Promise<Map<number, "paid" | "pending">> {
  const map = new Map<number, "paid" | "pending">();
  if (!messageIds.length) return map;
  const { data } = await supabaseAdmin()
    .from("telegram_unlocks")
    .select("tg_message_id, tg_peer, status, delivered_at")
    .eq("owner_id", ownerId)
    .in("tg_message_id", messageIds);
  const viewIsChannel = peer.startsWith("channel:");
  for (const row of data ?? []) {
    const rowIsChannel = String(row.tg_peer || "").startsWith("channel:");
    const match = viewIsChannel
      ? row.tg_peer === peer
      : !rowIsChannel;
    if (!match) continue;
    const id = Number(row.tg_message_id);
    if (!Number.isFinite(id)) continue;
    map.set(
      id,
      row.status === "paid" || row.status === "delivering" || row.delivered_at
        ? "paid"
        : "pending"
    );
  }
  return map;
}

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
    const ppv = await ppvByMessageId(
      ownerId,
      peer,
      messages.filter((m) => m.out).map((m) => m.id)
    ).catch(() => new Map<number, "paid" | "pending">());
    const withPpv = messages.map((m) => ({
      ...m,
      ppv: (m.out && ppv.get(m.id)) || null,
    }));
    return NextResponse.json({ messages: withPpv });
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
