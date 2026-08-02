import { NextResponse } from "next/server";
import { getUnlock } from "@/lib/telegramUnlock";
import { buildBlurredStill } from "@/lib/telegram";

/**
 * Public blurred still of a pending unlock — never the clear file.
 * Used on /u/[id] so fans see a real preview, not an empty placeholder.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const unlock = await getUnlock(id);
  if (!unlock) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const jpeg = await buildBlurredStill(unlock.media_path, unlock.media_type);
    return new NextResponse(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not build teaser" }, { status: 500 });
  }
}
