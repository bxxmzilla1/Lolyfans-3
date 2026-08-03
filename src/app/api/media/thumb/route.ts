import { NextRequest, NextResponse } from "next/server";
import { mediaUrl } from "@/lib/utils";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { tgSessionFor, tgDownloadMessageMedia } from "@/lib/telegram";

/**
 * Low-res thumbnail proxy for vault grids: resizes stored images so lists
 * load fast. Sends/PPVs always use the original full-res file. Non-image
 * files (videos) redirect to the original URL.
 *
 * Telegram vault items ("tg:<messageId>") serve the thumbnail cached in
 * storage by the sync; a miss is fetched live from Saved Messages and
 * written back, so grids self-heal.
 */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path")?.trim() || "";
  const w = Math.min(
    640,
    Math.max(64, Number(req.nextUrl.searchParams.get("w")) || 320)
  );
  if (!path || path.includes("..")) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  let original: Buffer;
  if (path.startsWith("tg:")) {
    const ownerId = await getOwnerId();
    if (!ownerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const messageId = Math.floor(Number(path.slice(3)));
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return NextResponse.json({ error: "Bad path" }, { status: 400 });
    }
    const stored = `tg-thumbs/${ownerId}/${messageId}.jpg`;
    let buf: Buffer | null = null;
    const res = await fetch(mediaUrl(stored)).catch(() => null);
    if (res?.ok) buf = Buffer.from(await res.arrayBuffer());
    if (!buf) {
      const session = await tgSessionFor(ownerId).catch(() => null);
      if (session) {
        const dl = await tgDownloadMessageMedia({
          session,
          peer: "me",
          messageId,
        }).catch(() => null);
        if (dl?.data?.length) {
          buf = dl.data;
          // Write back so the next grid load skips Telegram entirely.
          try {
            await supabaseAdmin()
              .storage.from("media")
              .upload(stored, buf, { contentType: "image/jpeg", upsert: true });
          } catch {
            // cosmetic
          }
        }
      }
    }
    if (!buf) return NextResponse.json({ error: "Not found" }, { status: 404 });
    original = buf;
  } else {
    const res = await fetch(mediaUrl(path));
    if (!res.ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    original = Buffer.from(await res.arrayBuffer());
  }

  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(original)
      .rotate()
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 55 })
      .toBuffer();
    return new NextResponse(new Uint8Array(out), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    if (path.startsWith("tg:")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Not an image (e.g. a video) — fall back to the original file.
    return NextResponse.redirect(mediaUrl(path));
  }
}
