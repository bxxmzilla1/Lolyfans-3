import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { getRequestCountry, ipFromHeaders, inviteUsable, countryAllowed } from "@/lib/invites";
import { checkSmsVerification, isE164 } from "@/lib/twilio";
import { hashPassword, verifyPassword } from "@/lib/password";
import { broadcast } from "@/lib/realtime";

/**
 * Creates (or resumes) a guest chat after phone sign-up: the guest registered
 * with a phone number + password and proved ownership of the number with the
 * SMS code Twilio sent them.
 */
export async function POST(req: NextRequest) {
  const { code, phone, password, otp } = await req.json();

  if (!code) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }
  const phoneStr = String(phone || "");
  if (!isE164(phoneStr)) {
    return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
  }
  const passwordStr = String(password || "");
  if (passwordStr.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }
  const otpStr = String(otp || "").trim();
  if (!/^\d{4,10}$/.test(otpStr)) {
    return NextResponse.json({ error: "Enter the verification code" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const ip = ipFromHeaders(req.headers);

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

  // The phone must be verified through Twilio before anything is created.
  const otpError = await checkSmsVerification(phoneStr, otpStr);
  if (otpError) {
    return NextResponse.json({ error: otpError }, { status: 400 });
  }

  // This phone already has an account with this creator? Check the password
  // and resume the existing chat instead of creating a duplicate.
  const { data: existing } = await db
    .from("chats")
    .select("id, guest_name, guest_password")
    .eq("owner_id", invite!.owner_id)
    .eq("guest_phone", phoneStr)
    .maybeSingle();

  if (existing) {
    if (!verifyPassword(passwordStr, existing.guest_password || "")) {
      return NextResponse.json(
        { error: "This phone number is already registered, but the password is wrong" },
        { status: 403 }
      );
    }
    // Keep the device binding fresh so IP-based resume keeps working.
    after(async () => {
      if (ip) await db.from("chats").update({ guest_ip: ip }).eq("id", existing.id);
    });
    const res = NextResponse.json({ ok: true, chatId: existing.id });
    res.cookies.set(
      GUEST_COOKIE,
      createToken({ chatId: existing.id, name: existing.guest_name }),
      cookieOptions
    );
    return res;
  }

  const guestName = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
  const { data: chat, error } = await db
    .from("chats")
    .insert({
      owner_id: invite!.owner_id,
      invite_id: invite!.id,
      guest_name: guestName,
      guest_country: country,
      guest_ip: ip,
      guest_phone: phoneStr,
      guest_password: hashPassword(passwordStr),
    })
    .select()
    .single();
  if (error || !chat) {
    return NextResponse.json({ error: "Could not create chat" }, { status: 500 });
  }

  // Bookkeeping + notifications after the response is sent: bump the usage
  // counter and tell listeners (web inbox, Orion) a new chat just appeared.
  after(async () => {
    await Promise.all([
      db
        .from("invites")
        .update({ uses: (invite!.uses ?? 0) + 1 })
        .eq("id", invite!.id),
      broadcast(`inbox:${invite!.owner_id}`, "new-chat", { chatId: chat.id }),
    ]);
  });

  const res = NextResponse.json({ ok: true, chatId: chat.id });
  res.cookies.set(GUEST_COOKIE, createToken({ chatId: chat.id, name: guestName }), cookieOptions);
  return res;
}
