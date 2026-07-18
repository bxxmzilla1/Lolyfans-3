import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { getRequestCountry, ipFromHeaders, inviteUsable, countryAllowed } from "@/lib/invites";
import { hashPassword, verifyPassword } from "@/lib/password";
import { broadcast } from "@/lib/realtime";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Creates (or resumes) a guest chat after sign-up: the guest registers with
 * an email + password. No verification step — the account works right away.
 */
export async function POST(req: NextRequest) {
  const { code, name, email, password } = await req.json();

  if (!code) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }
  const emailStr = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(emailStr)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  const passwordStr = String(password || "");
  if (passwordStr.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
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

  // This email already has an account with this creator? Check the password
  // and resume the existing chat instead of creating a duplicate.
  const { data: existing } = await db
    .from("chats")
    .select("id, guest_name, guest_password")
    .eq("owner_id", invite!.owner_id)
    .eq("guest_email", emailStr)
    .maybeSingle();

  if (existing) {
    if (!verifyPassword(passwordStr, existing.guest_password || "")) {
      return NextResponse.json(
        { error: "This email is already registered, but the password is wrong" },
        { status: 403 }
      );
    }
    // Keep the device binding fresh so IP-based resume keeps working, and
    // make sure they follow the inviter (their posts show in the home feed).
    after(async () => {
      await Promise.all([
        ip
          ? db.from("chats").update({ guest_ip: ip }).eq("id", existing.id)
          : Promise.resolve(),
        db
          .from("follows")
          .upsert(
            { chat_id: existing.id, owner_id: invite!.owner_id },
            { onConflict: "chat_id,owner_id", ignoreDuplicates: true }
          ),
      ]);
    });
    const res = NextResponse.json({ ok: true, chatId: existing.id });
    res.cookies.set(
      GUEST_COOKIE,
      createToken({ chatId: existing.id, name: existing.guest_name }),
      cookieOptions
    );
    return res;
  }

  // The name typed at sign-up; auto-generate one only as a fallback.
  const guestName =
    String(name || "").trim().slice(0, 40) ||
    `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
  const { data: chat, error } = await db
    .from("chats")
    .insert({
      owner_id: invite!.owner_id,
      invite_id: invite!.id,
      guest_name: guestName,
      guest_country: country,
      guest_ip: ip,
      guest_email: emailStr,
      guest_password: hashPassword(passwordStr),
    })
    .select()
    .single();
  if (error || !chat) {
    return NextResponse.json({ error: "Could not create chat" }, { status: 500 });
  }

  // Bookkeeping + notifications after the response is sent: bump the usage
  // counter, auto-follow the inviter so their posts fill the new fan's home
  // feed, and tell listeners (web inbox, Orion) a new chat just appeared.
  after(async () => {
    await Promise.all([
      db
        .from("invites")
        .update({ uses: (invite!.uses ?? 0) + 1 })
        .eq("id", invite!.id),
      db
        .from("follows")
        .upsert(
          { chat_id: chat.id, owner_id: invite!.owner_id },
          { onConflict: "chat_id,owner_id", ignoreDuplicates: true }
        ),
      broadcast(`inbox:${invite!.owner_id}`, "new-chat", { chatId: chat.id }),
    ]);
  });

  const res = NextResponse.json({ ok: true, chatId: chat.id });
  res.cookies.set(GUEST_COOKIE, createToken({ chatId: chat.id, name: guestName }), cookieOptions);
  return res;
}
