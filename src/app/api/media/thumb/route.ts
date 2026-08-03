import { NextRequest, NextResponse } from "next/server";
import { mediaUrl } from "@/lib/utils";

/**
 * Low-res thumbnail proxy for vault grids: resizes stored images so lists
 * load fast. Sends/PPVs always use the original full-res file. Non-image
 * files (videos) redirect to the original URL.
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
    return new NextResponse(new Uint8Array(out), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    // Not an image (e.g. a video) — fall back to the original file.
    return NextResponse.redirect(mediaUrl(path));
  }
}
