import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ownerFromApiKey } from "@/lib/apiKey";
import { requestOrigin } from "@/lib/smsNotify";
import {
  telegramConfigured,
  tgSessionFor,
  tgSendText,
  tgSendTeaser,
  tgSendVoiceNote,
  tgDeliverMedia,
} from "@/lib/telegram";
import { savedCardChatForPeer } from "@/lib/telegramUnlock";
import { getMediaCache, downloadTeaserClip } from "@/lib/telegramMediaCache";

// A priced send may upload clear media when no Saved Messages copy exists.
export const maxDuration = 800;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

type MediaItem = { path: string; type: "image" | "video" | "audio" };

function shortPayCode(): string {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/**
 * Send one locked media file as a Telegram PPV: create the unlock row (its
 * short code is the pay-link token), send a blurred teaser + link (or a
 * double-tap-to-pay prompt for fans with a saved card), and let the fan pay
 * on /payment/<code>. Mirrors /api/telegram/send for a single item.
 */
async function sendPricedPpv(opts: {
  ownerId: string;
  session: string;
  peer: string;
  item: MediaItem;
  priceCents: number;
  caption: string;
  origin: string;
}): Promise<void> {
  const { ownerId, session, peer, item, priceCents, caption, origin } = opts;
  const mediaType = item.type === "video" ? "video" : "image";
  const db = supabaseAdmin();

  const cache = await getMediaCache(ownerId, item.path).catch(() => null);

  const row = {
    owner_id: ownerId,
    media_path: item.path,
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
    shortCode = null;
    ({ data: unlock, error } = await db
      .from("telegram_unlocks")
      .insert(row)
      .select()
      .single());
  }
  if (error || !unlock) throw new Error("Could not create the unlock link");

  const payOrigin =
    (process.env.PPV_PAYLINK_ORIGIN || "").trim().replace(/\/+$/, "") || origin;
  const link = shortCode
    ? `${payOrigin}/payment/${shortCode}`
    : `${payOrigin}/u/${unlock.id}`;
  const isDm = !peer.startsWith("channel:") && !peer.startsWith("chat:");
  const reactionPay = isDm && !!(await savedCardChatForPeer(ownerId, peer));
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
    const preClip =
      mediaType === "video" && cache?.teaserPath
        ? await downloadTeaserClip(cache.teaserPath)
        : null;
    const messageId = await tgSendTeaser({
      session,
      peer,
      mediaPath: item.path,
      mediaType,
      caption: teaserCaption,
      priceCents,
      preClip,
    });
    const updates: Record<string, unknown> = {};
    if (messageId) updates.tg_message_id = messageId;
    if (cache?.tgMessageId) updates.tg_cached_message_id = cache.tgMessageId;
    if (Object.keys(updates).length) {
      await db.from("telegram_unlocks").update(updates).eq("id", unlock.id);
    }
  } catch (err) {
    await db.from("telegram_unlocks").delete().eq("id", unlock.id);
    throw err;
  }
}

function friendlyTgError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Could not send the message";
  if (/USERNAME_NOT_OCCUPIED|PEER_ID_INVALID|USERNAME_INVALID/.test(msg)) {
    return "Couldn't find that Telegram user";
  }
  if (/that user|privacy|PEER_FLOOD/i.test(msg)) {
    return "Telegram wouldn't let you message that user (privacy or rate limit)";
  }
  return msg;
}

/**
 * External send API for Orion. `chatId` is the Telegram peer key. Sends a
 * reply into the fan's DM: plain text, a free media drop, a locked PPV, or a
 * voice note. Media "packages" (mediaItems array) send one Telegram message
 * per item; a positive priceCents locks EACH item at that price (Telegram
 * PPVs are one-file-one-price, unlike the old bundled locked message).
 */
export async function POST(req: NextRequest) {
  const ownerId = await ownerFromApiKey(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS });
  }
  if (!telegramConfigured()) {
    return NextResponse.json(
      { error: "Telegram is not configured on the server" },
      { status: 503, headers: CORS }
    );
  }
  const session = await tgSessionFor(ownerId);
  if (!session) {
    return NextResponse.json(
      { error: "Connect your Telegram account first (Settings → Telegram)" },
      { status: 400, headers: CORS }
    );
  }

  const body = await req.json().catch(() => ({}));
  const peer = String(body.chatId || "").trim();
  const content = String(body.content || "").trim();
  const priceCents =
    Number.isFinite(Number(body.priceCents)) && Number(body.priceCents) > 0
      ? Math.max(0, Math.round(Number(body.priceCents)))
      : 0;

  const normType = (t: unknown): MediaItem["type"] =>
    t === "video" ? "video" : t === "audio" ? "audio" : "image";
  const mediaItems: MediaItem[] = [];
  if (Array.isArray(body.mediaItems)) {
    for (const it of body.mediaItems) {
      if (it && typeof it.path === "string" && it.path) {
        mediaItems.push({ path: it.path, type: normType(it.type) });
      }
    }
  }
  if (mediaItems.length === 0 && typeof body.mediaPath === "string" && body.mediaPath) {
    mediaItems.push({ path: body.mediaPath, type: normType(body.mediaType) });
  }

  if (!peer) {
    return NextResponse.json({ error: "chatId required" }, { status: 400, headers: CORS });
  }
  if (!content && mediaItems.length === 0) {
    return NextResponse.json({ error: "Empty message" }, { status: 400, headers: CORS });
  }

  const origin = requestOrigin(req.headers);

  try {
    // Text-only reply.
    if (mediaItems.length === 0) {
      await tgSendText({ session, peer, text: content });
      return NextResponse.json({ ok: true }, { headers: CORS });
    }

    // Media: one Telegram message per item. The caption rides on the first
    // item only, so a package doesn't repeat the same line under every file.
    for (let i = 0; i < mediaItems.length; i++) {
      const item = mediaItems[i];
      const caption = i === 0 ? content : "";

      if (item.type === "audio") {
        await tgSendVoiceNote({ session, peer, mediaPath: item.path, caption });
        continue;
      }
      if (priceCents > 0) {
        await sendPricedPpv({
          ownerId,
          session,
          peer,
          item,
          priceCents,
          caption,
          origin,
        });
        continue;
      }
      // Free drop: deliver the clear media directly.
      const cache = await getMediaCache(ownerId, item.path).catch(() => null);
      await tgDeliverMedia({
        session,
        peer,
        mediaPath: item.path,
        mediaType: item.type,
        caption,
        cachedMessageId: cache?.tgMessageId ?? null,
      });
      try {
        await supabaseAdmin().from("telegram_unlocks").insert({
          owner_id: ownerId,
          media_path: item.path,
          media_type: item.type,
          price_cents: 0,
          tg_peer: peer,
          status: "free",
        });
      } catch {
        // logging the free send is best-effort
      }
    }

    return NextResponse.json({ ok: true }, { headers: CORS });
  } catch (err) {
    return NextResponse.json(
      { error: friendlyTgError(err) },
      { status: 400, headers: CORS }
    );
  }
}
