import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import {
  telegramConfigured,
  tgDownloadMessageMedia,
  tgSessionFor,
} from "@/lib/telegram";

// Full-file downloads (vault viewer for Saved Messages videos) can be big.
export const maxDuration = 300;

/**
 * Proxy a Telegram message's media (thumbnail/file) for the creator inbox
 * and the Saved Messages vault (peer=me). `full=1` fetches the real file
 * instead of a thumbnail — used by the vault viewer and downloads.
 * Auth required — never expose arbitrary Telegram downloads publicly.
 */
export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const peer = req.nextUrl.searchParams.get("peer")?.trim();
  const id = Number(req.nextUrl.searchParams.get("id"));
  const full = req.nextUrl.searchParams.get("full") === "1";
  if (!peer || !Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "peer and id required" }, { status: 400 });
  }

  if (!telegramConfigured()) {
    return NextResponse.json({ error: "Telegram is not configured" }, { status: 503 });
  }

  const session = await tgSessionFor(ownerId);
  if (!session) {
    return NextResponse.json({ error: "Connect Telegram first" }, { status: 400 });
  }

  try {
    const file = await tgDownloadMessageMedia({
      session,
      peer,
      messageId: id,
      full,
    });
    if (!file) {
      return NextResponse.json({ error: "No media" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.mime,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not load media";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
