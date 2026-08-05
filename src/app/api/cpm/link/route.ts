import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { ensureCpmLink } from "@/lib/cpm";
import { requestOrigin } from "@/lib/smsNotify";
import { headers } from "next/headers";

/**
 * Creator's Chat-per-minute share link. Creates one on first open.
 */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const code = await ensureCpmLink(ownerId);
    const h = await headers();
    const origin = requestOrigin(h);
    return NextResponse.json({
      code,
      url: `${origin}/m/${code}`,
      pricePerMinCents: 100,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not create link";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
