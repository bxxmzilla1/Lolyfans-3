import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRequestCountry, inviteUsable, countryAllowed } from "@/lib/invites";
import { startSmsVerification, isE164 } from "@/lib/twilio";

/**
 * Sends the SMS verification code to a guest signing up through an invite
 * link. The invite is validated first so bad links can't be used to fire
 * SMS at random numbers.
 */
export async function POST(req: NextRequest) {
  const { code, phone } = await req.json();
  if (!code || !isE164(String(phone || ""))) {
    return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: invite } = await db.from("invites").select("*").eq("code", code).single();

  const usable = inviteUsable(invite);
  if (!usable.ok) {
    return NextResponse.json({ error: usable.reason }, { status: 403 });
  }
  const country = getRequestCountry(req);
  if (!countryAllowed(invite!.allowed_countries, country)) {
    return NextResponse.json(
      { error: "This chat link is not available in your country" },
      { status: 403 }
    );
  }

  const error = await startSmsVerification(String(phone));
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
