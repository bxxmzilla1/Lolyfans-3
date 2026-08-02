import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import {
  telegramConfigured,
  tgDownloadProfilePhoto,
  tgSessionFor,
} from "@/lib/telegram";

/**
 * Clear (small) Telegram profile photo for the inbox list. Cached for a week
 * per peer so the list only pays the download cost once.
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
    return NextResponse.json({ error: "Connect Telegram first" }, { status: 400 });
  }

  try {
    const photo = await tgDownloadProfilePhoto({ session, peer });
    if (!photo) {
      return NextResponse.json({ error: "No photo" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(photo), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=604800",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not load photo" }, { status: 500 });
  }
}
