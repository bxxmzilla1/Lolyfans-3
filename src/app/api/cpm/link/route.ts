import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appOrigin, cpmLinkSettings, ensureCpmLink } from "@/lib/cpm";

/**
 * Creator's Chat-per-minute share link (always on Lolyfans). Opening it
 * redirects unpaid fans to the pay-link domain for the card page.
 * Also returns the saved landing-page customization.
 */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const code = await ensureCpmLink(ownerId);
    const settings = await cpmLinkSettings(code);
    return NextResponse.json({
      code,
      url: `${appOrigin()}/m/${code}`,
      pricePerMinCents: 100,
      ...settings,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not create link";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Save the landing-page customization: custom benefit bullet points, the
 * "available for N people only / N left" scarcity counters and the FOMO
 * countdown timer. Empty/omitted values switch each piece off.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  const benefits = Array.isArray(body.benefits)
    ? (body.benefits as unknown[])
        .filter((b): b is string => typeof b === "string")
        .map((b) => b.trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const num = (v: unknown, max: number): number | null => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : null;
  };
  const slotsTotal = num(body.slotsTotal, 9999);
  // Spots left only makes sense with a total; clamp it inside the total.
  const slotsLeft =
    slotsTotal !== null
      ? Math.min(num(body.slotsLeft, 9999) ?? slotsTotal, slotsTotal)
      : null;
  const timerMinutes = num(body.timerMinutes, 7 * 24 * 60);

  try {
    await ensureCpmLink(ownerId);
    const { error } = await supabaseAdmin()
      .from("cpm_links")
      .update({
        benefits: benefits.length ? benefits : null,
        slots_total: slotsTotal,
        slots_left: slotsLeft,
        timer_minutes: timerMinutes,
      })
      .eq("owner_id", ownerId);
    if (error) {
      if (/column|benefits|slots|timer/i.test(error.message)) {
        return NextResponse.json(
          { error: "Run the Chat per minute landing DB migration first" },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not save";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
