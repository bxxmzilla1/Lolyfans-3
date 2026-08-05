import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { appOrigin, ensureCpmLink } from "@/lib/cpm";

/**
 * Creator's Chat-per-minute share link (always on Lolyfans). Opening it
 * redirects unpaid fans to the pay-link domain for the card page.
 */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const code = await ensureCpmLink(ownerId);
    return NextResponse.json({
      code,
      url: `${appOrigin()}/m/${code}`,
      pricePerMinCents: 100,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not create link";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
