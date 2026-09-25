import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { ipFromHeaders } from "@/lib/invites";
import { verifyPassword } from "@/lib/password";
import { guestAccessDestination } from "@/lib/subscriptionAccess";
import { verifyWalletSignIn } from "@/lib/walletAuth";

type ChatRow = { id: string; guest_name: string; owner_id: string; guest_password?: string | null };

/**
 * Fan login on any device: "Continue with Phantom" (signed challenge), or —
 * for accounts created before wallet sign-up — the old email + password.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = supabaseAdmin();

  let chat: ChatRow | null = null;
  if (body.publicKey) {
    const wallet = verifyWalletSignIn(body);
    if (!wallet) {
      return NextResponse.json(
        { error: "Wallet signature could not be verified — try again" },
        { status: 401 }
      );
    }
    const { data: chats } = await db
      .from("chats")
      .select("id, guest_name, owner_id")
      .eq("guest_wallet", wallet)
      .order("last_message_at", { ascending: false })
      .limit(1);
    chat = (chats?.[0] as ChatRow | undefined) ?? null;
    if (!chat) {
      return NextResponse.json(
        { error: "No account for this wallet yet — open a creator's link to sign up" },
        { status: 404 }
      );
    }
  } else {
    const emailStr = String(body.email || "").trim().toLowerCase();
    const passwordStr = String(body.password || "");
    if (!emailStr || !passwordStr) {
      return NextResponse.json({ error: "Enter your email and password" }, { status: 400 });
    }
    const { data: chats } = await db
      .from("chats")
      .select("id, guest_name, guest_password, last_message_at, owner_id")
      .eq("guest_email", emailStr)
      .order("last_message_at", { ascending: false });
    if (!chats?.length) {
      return NextResponse.json({ error: "No account found with this email" }, { status: 404 });
    }
    // The same email can be registered with several creators (each sign-up
    // has its own password) — any matching password logs them in.
    chat =
      (chats.find((c) => verifyPassword(passwordStr, c.guest_password || "")) as
        | ChatRow
        | undefined) ?? null;
    if (!chat) {
      return NextResponse.json({ error: "Wrong password" }, { status: 403 });
    }
  }

  // Remember this device by IP so the bare domain reopens their chats.
  const ip = ipFromHeaders(req.headers);
  const chatId = chat.id;
  if (ip) {
    after(async () => {
      await db.from("chats").update({ guest_ip: ip }).eq("id", chatId);
    });
  }

  const dest = await guestAccessDestination(chat.id, chat.owner_id);
  const res = NextResponse.json({
    ok: true,
    redirect: dest.allowed ? "/home" : dest.href,
  });
  res.cookies.set(
    GUEST_COOKIE,
    createToken({ chatId: chat.id, name: chat.guest_name }),
    cookieOptions
  );
  return res;
}
