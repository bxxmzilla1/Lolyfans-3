import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { ipFromHeaders } from "@/lib/invites";
import { verifyPassword } from "@/lib/password";

/**
 * Fan login: guests who signed up through an invite link can sign in on any
 * device (e.g. a computer) with the same email + password.
 */
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  const emailStr = String(email || "").trim().toLowerCase();
  const passwordStr = String(password || "");
  if (!emailStr || !passwordStr) {
    return NextResponse.json({ error: "Enter your email and password" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: chats } = await db
    .from("chats")
    .select("id, guest_name, guest_password, last_message_at")
    .eq("guest_email", emailStr)
    .order("last_message_at", { ascending: false });

  if (!chats?.length) {
    return NextResponse.json(
      { error: "No account found with this email" },
      { status: 404 }
    );
  }

  // The same email can be registered with several creators (each sign-up has
  // its own password) — any matching password logs them in.
  const chat = chats.find((c) => verifyPassword(passwordStr, c.guest_password || ""));
  if (!chat) {
    return NextResponse.json({ error: "Wrong password" }, { status: 403 });
  }

  // Remember this device by IP so the bare domain reopens their chats.
  const ip = ipFromHeaders(req.headers);
  if (ip) {
    after(async () => {
      await db.from("chats").update({ guest_ip: ip }).eq("id", chat.id);
    });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    GUEST_COOKIE,
    createToken({ chatId: chat.id, name: chat.guest_name }),
    cookieOptions
  );
  return res;
}
