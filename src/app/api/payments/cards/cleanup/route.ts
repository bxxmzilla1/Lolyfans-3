import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { stripeConfigured } from "@/lib/stripe";
import { pruneStaleCards } from "@/lib/stripeCards";

/**
 * Settings → Subscription → "Clean up saved cards". Body: { cursor } from
 * the previous page (omit to start). Removes saved cards/customers that
 * don't exist in the currently connected Stripe account, one page per call.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const cursor = typeof body.cursor === "string" && body.cursor ? body.cursor : null;

  try {
    return NextResponse.json(await pruneStaleCards(cursor));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cleanup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
