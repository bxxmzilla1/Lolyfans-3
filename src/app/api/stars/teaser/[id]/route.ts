import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildBlurredStill } from "@/lib/telegram";

/**
 * Public blurred still of a Stars PPV — never the clear file. Keyed by the
 * unguessable unlock uuid; used as the photo on forwardable Stars invoices
 * so fans see a real (blurred) preview instead of a bare invoice.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { data: unlock } = await supabaseAdmin()
    .from("stars_unlocks")
    .select("media_path, media_type")
    .eq("id", id)
    .maybeSingle();
  if (!unlock?.media_path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const jpeg = await buildBlurredStill(
      unlock.media_path,
      unlock.media_type === "video" ? "video" : "image"
    );
    return new NextResponse(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not build teaser" },
      { status: 500 }
    );
  }
}
