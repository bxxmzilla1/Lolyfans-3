import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { requestOrigin } from "@/lib/smsNotify";
import { tgSessionFor, tgSendTeaser, tgDeliverMedia } from "@/lib/telegram";

/**
 * Creator sends a vault item into a fan's Telegram DM. With a price it's a
 * locked PPV: we create an unlock row (its id is the pay-link token), send a
 * blurred teaser + link, and wait for the fan to pay. Without a price the
 * clear media is sent directly, for free.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await tgSessionFor(ownerId);
  if (!session) {
    return NextResponse.json(
      { error: "Connect your Telegram account first (Settings → Telegram)" },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const mediaPath = String(body.mediaPath || "").trim();
  const mediaType = body.mediaType === "video" ? "video" : "image";
  const priceCents = Math.round(Number(body.priceCents)) || 0;
  let peer = String(body.peer || "").trim();
  const caption = String(body.caption || "").trim().slice(0, 300);

  if (!mediaPath) return NextResponse.json({ error: "Pick a media file" }, { status: 400 });
  if (priceCents > 0 && priceCents < 100) {
    return NextResponse.json({ error: "Minimum price is $1 (or leave it empty to send free)" }, { status: 400 });
  }
  if (!peer) {
    return NextResponse.json({ error: "Enter the fan's @username or phone" }, { status: 400 });
  }
  // Accept peer keys from the Telegram inbox (user:/channel:/chat:),
  // "@name", bare username, or phone.
  const isPeerKey =
    peer.startsWith("user:") ||
    peer.startsWith("channel:") ||
    peer.startsWith("chat:");
  if (!isPeerKey && !peer.startsWith("@") && !/^\+?\d{6,15}$/.test(peer)) {
    peer = `@${peer}`;
  }

  // No price → send the clear media directly, free of charge.
  if (priceCents <= 0) {
    try {
      await tgDeliverMedia({
        session,
        peer,
        mediaPath,
        mediaType,
        caption,
      });
      return NextResponse.json({ ok: true, free: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not send the message";
      const friendly = /USERNAME_NOT_OCCUPIED|PEER_ID_INVALID|USERNAME_INVALID/.test(msg)
        ? "Couldn't find that Telegram user — check the @username or phone"
        : /that user|privacy|PEER_FLOOD/i.test(msg)
          ? "Telegram wouldn't let you message that user (privacy settings or rate limit)"
          : msg;
      return NextResponse.json({ error: friendly }, { status: 400 });
    }
  }

  const db = supabaseAdmin();
  const { data: unlock, error } = await db
    .from("telegram_unlocks")
    .insert({
      owner_id: ownerId,
      media_path: mediaPath,
      media_type: mediaType,
      price_cents: priceCents,
      tg_peer: peer,
      status: "pending",
    })
    .select()
    .single();
  if (error || !unlock) {
    return NextResponse.json({ error: "Could not create the unlock link" }, { status: 500 });
  }

  const origin = requestOrigin(req.headers);
  const link = `${origin}/u/${unlock.id}`;
  // Price lives on the blurred media overlay; caption is optional note + tap link.
  const safeCaption = caption
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const teaserCaption = [
    safeCaption,
    `🔓 <b><a href="${link}">Tap Here To Unlock</a></b>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    await tgSendTeaser({
      session,
      peer,
      mediaPath,
      mediaType,
      caption: teaserCaption,
      priceCents,
    });
  } catch (err) {
    // Roll back the row so a failed send doesn't leave a dangling link.
    await db.from("telegram_unlocks").delete().eq("id", unlock.id);
    const msg = err instanceof Error ? err.message : "Could not send the message";
    const friendly = /USERNAME_NOT_OCCUPIED|PEER_ID_INVALID|USERNAME_INVALID/.test(msg)
      ? "Couldn't find that Telegram user — check the @username or phone"
      : /that user|privacy|PEER_FLOOD/i.test(msg)
        ? "Telegram wouldn't let you message that user (privacy settings or rate limit)"
        : msg;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }

  return NextResponse.json({ ok: true, unlockId: unlock.id, link });
}
