import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { requestOrigin } from "@/lib/smsNotify";
import { tgSessionFor, tgSendTeaser, tgDeliverMedia } from "@/lib/telegram";
import { savedCardChatForPeer } from "@/lib/telegramUnlock";

/** Short unguessable token for the /payment/<code> link (8 base62 chars). */
function shortPayCode(): string {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

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
      // Record the free send so the vault can flag this media as
      // "sent free" (status highlights). Best-effort — the media is
      // already delivered, so a logging hiccup must not fail the request.
      try {
        await supabaseAdmin().from("telegram_unlocks").insert({
          owner_id: ownerId,
          media_path: mediaPath,
          media_type: mediaType,
          price_cents: 0,
          tg_peer: peer,
          status: "free",
        });
      } catch {
        // ignore
      }
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
  const row = {
    owner_id: ownerId,
    media_path: mediaPath,
    media_type: mediaType,
    price_cents: priceCents,
    tg_peer: peer,
    status: "pending",
  };
  let shortCode: string | null = shortPayCode();
  let { data: unlock, error } = await db
    .from("telegram_unlocks")
    .insert({ ...row, short_code: shortCode })
    .select()
    .single();
  if (error || !unlock) {
    // short_code column missing (migration not run yet) or a one-in-a-
    // trillion collision — fall back to the long /u/<id> link.
    shortCode = null;
    ({ data: unlock, error } = await db
      .from("telegram_unlocks")
      .insert(row)
      .select()
      .single());
  }
  if (error || !unlock) {
    return NextResponse.json({ error: "Could not create the unlock link" }, { status: 500 });
  }

  const origin = requestOrigin(req.headers);
  const link = shortCode
    ? `${origin}/payment/${shortCode}`
    : `${origin}/u/${unlock.id}`;
  // Fans with a card on file pay by reacting to the teaser (DMs only), so
  // they get a double-tap prompt instead of the payment link.
  const isDm = !peer.startsWith("channel:") && !peer.startsWith("chat:");
  const reactionPay = isDm && !!(await savedCardChatForPeer(ownerId, peer));
  // Price lives on the blurred media overlay; caption is optional note + tap link.
  const safeCaption = caption
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const teaserCaption = [
    safeCaption,
    reactionPay
      ? `❤️ <b>Double-tap this message to unlock</b>`
      : `🔓 <b><a href="${link}">Tap Here To Unlock</a></b>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const messageId = await tgSendTeaser({
      session,
      peer,
      mediaPath,
      mediaType,
      caption: teaserCaption,
      priceCents,
    });
    // Remember the teaser message so a double-tap reaction on it can
    // auto-charge a fan with a saved card. Best-effort (column may not
    // exist until the migration runs).
    if (messageId) {
      await db
        .from("telegram_unlocks")
        .update({ tg_message_id: messageId })
        .eq("id", unlock.id);
    }
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
