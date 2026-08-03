import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { tgSessionFor, tgDownloadMessageMedia } from "@/lib/telegram";

// Long videos take a while to pull out of Telegram.
export const maxDuration = 300;

/**
 * Copy a Saved Messages vault item ("tg:<messageId>") into the public media
 * bucket and return the storage path. Needed wherever guests must load the
 * file directly (mass messages, the Pin Blurdrainer profile video) — they
 * can't fetch from the creator's Telegram. Idempotent: an existing copy is
 * returned without downloading again.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const mediaPath = String(body.mediaPath || "").trim();
  if (!mediaPath) {
    return NextResponse.json({ error: "mediaPath required" }, { status: 400 });
  }
  // Already a storage file — nothing to do.
  if (!mediaPath.startsWith("tg:")) {
    return NextResponse.json({ path: mediaPath });
  }
  const messageId = Math.floor(Number(mediaPath.slice(3)));
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return NextResponse.json({ error: "Bad mediaPath" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Reuse an existing copy from a previous materialize.
  try {
    const { data: existing } = await db.storage
      .from("media")
      .list(`tg-mirror/${ownerId}`, { search: `${messageId}.` });
    const hit = (existing ?? []).find((f) =>
      f.name.startsWith(`${messageId}.`)
    );
    if (hit) {
      return NextResponse.json({ path: `tg-mirror/${ownerId}/${hit.name}` });
    }
  } catch {
    // fall through to a fresh download
  }

  const session = await tgSessionFor(ownerId);
  if (!session) {
    return NextResponse.json({ error: "Connect Telegram first" }, { status: 400 });
  }

  const file = await tgDownloadMessageMedia({
    session,
    peer: "me",
    messageId,
    full: true,
  }).catch(() => null);
  if (!file?.data?.length) {
    return NextResponse.json(
      { error: "Could not download this file from Telegram" },
      { status: 404 }
    );
  }

  const ext = file.mime.startsWith("video/") ? "mp4" : "jpg";
  const path = `tg-mirror/${ownerId}/${messageId}.${ext}`;
  const { error } = await db.storage
    .from("media")
    .upload(path, file.data, { contentType: file.mime, upsert: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ path });
}
