import { NextRequest, NextResponse } from "next/server";
import { ownerFromApiKey } from "@/lib/apiKey";
import {
  telegramConfigured,
  tgDownloadMessageMedia,
  tgSessionFor,
} from "@/lib/telegram";

// Downloading a Telegram video can take a moment.
export const maxDuration = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Stream one Telegram message's media to Orion. Telegram media has no public
 * URL, so /api/external/chats points every media message here (with the API
 * key in ?key= so a bare <img>/<video>/fetch works). Orion uses this both to
 * render fan media and to pull frames for Grok vision analysis.
 */
export async function GET(req: NextRequest) {
  const ownerId = await ownerFromApiKey(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS });
  }
  if (!telegramConfigured()) {
    return NextResponse.json({ error: "Telegram not configured" }, { status: 503, headers: CORS });
  }

  const peer = req.nextUrl.searchParams.get("peer")?.trim();
  const id = Math.floor(Number(req.nextUrl.searchParams.get("id") || 0));
  if (!peer || !id) {
    return NextResponse.json({ error: "peer and id required" }, { status: 400, headers: CORS });
  }

  const session = await tgSessionFor(ownerId);
  if (!session) {
    return NextResponse.json({ error: "Connect Telegram first" }, { status: 400, headers: CORS });
  }

  try {
    const media = await tgDownloadMessageMedia({ session, peer, messageId: id });
    if (!media) {
      return NextResponse.json({ error: "No media" }, { status: 404, headers: CORS });
    }
    return new NextResponse(new Uint8Array(media.data), {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": media.mime,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load media";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS });
  }
}
