import { NextRequest, NextResponse } from "next/server";
import { ownerIdForCpmCode } from "@/lib/cpm";
import {
  telegramConfigured,
  tgDownloadOwnProfilePhoto,
  tgSessionFor,
} from "@/lib/telegram";

/**
 * Public Telegram profile photo for the Chat-per-minute landing page.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const ownerId = await ownerIdForCpmCode(code.trim());
  if (!ownerId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!telegramConfigured()) {
    return NextResponse.json({ error: "No photo" }, { status: 404 });
  }
  const session = await tgSessionFor(ownerId);
  if (!session) return NextResponse.json({ error: "No photo" }, { status: 404 });

  try {
    const photo = await tgDownloadOwnProfilePhoto(session);
    if (!photo) return NextResponse.json({ error: "No photo" }, { status: 404 });
    return new NextResponse(new Uint8Array(photo), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "No photo" }, { status: 404 });
  }
}
