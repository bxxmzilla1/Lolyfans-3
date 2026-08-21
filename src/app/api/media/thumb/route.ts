import { NextRequest, NextResponse } from "next/server";
import { mediaUrl } from "@/lib/utils";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { videoFrameFromInput } from "@/lib/videoFrame";

export const runtime = "nodejs";
export const maxDuration = 60;

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;

/**
 * Low-res thumbnail proxy for vault grids: resized images, and for videos a
 * single frame grabbed with ffmpeg (cached in storage, so each video pays
 * the extraction cost once). Grids never load the actual video files —
 * that keeps big vaults fast; the full media loads when a tile is opened.
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

  if (VIDEO_EXT.test(path)) return videoThumb(path, w);

  const res = await fetch(mediaUrl(path));
  if (!res.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const original = Buffer.from(await res.arrayBuffer());

  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(original)
      .rotate()
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 55 })
      .toBuffer();
    return thumbResponse(out);
  } catch {
    // Not an image (e.g. a video with an odd extension) — try a frame grab.
    return videoThumb(path, w);
  }
}

async function videoThumb(path: string, w: number) {
  // Served straight from storage after the first request.
  const cachePath = `thumbs/w${w}/${path}.webp`;
  const cached = await fetch(mediaUrl(cachePath), { method: "HEAD" }).catch(
    () => null
  );
  if (cached?.ok) {
    return NextResponse.redirect(mediaUrl(cachePath), {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }

  try {
    // ffmpeg reads the first frame straight from the storage URL — no full
    // video download.
    const frame = await videoFrameFromInput(mediaUrl(path));
    const sharp = (await import("sharp")).default;
    const out = await sharp(frame)
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 55 })
      .toBuffer();

    await supabaseAdmin()
      .storage.from("media")
      .upload(cachePath, out, { contentType: "image/webp", upsert: true })
      .catch(() => {});

    return thumbResponse(out);
  } catch {
    return NextResponse.json({ error: "Could not build thumb" }, { status: 500 });
  }
}

function thumbResponse(out: Buffer) {
  return new NextResponse(new Uint8Array(out), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
