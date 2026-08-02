import crypto from "crypto";
import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { getRequestCountry, ipFromHeaders, inviteUsable, countryAllowed } from "@/lib/invites";
import { hashPassword, verifyPassword } from "@/lib/password";
import { broadcast } from "@/lib/realtime";
import { ownerRequiresPaidSub } from "@/lib/subscriptionAccess";
import { recordInviteEvent } from "@/lib/inviteEvents";
import { getTelegramFan, telegramFanRow } from "@/lib/telegramLogin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Creates (or resumes) a guest chat after sign-up. Two ways in:
 *  - classic form: name + email + password, or
 *  - `telegram: true`: the identity comes from the verified Telegram Login
 *    Widget cookie — no form at all. The account is keyed on a synthetic
 *    email derived from the Telegram user id, so the same Telegram user
 *    always resumes the same chat with this creator.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { code, name, email, password } = body;

  if (!code) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }

  const viaTelegram = body.telegram === true;
  let emailStr: string;
  let tgName: string | null = null;
  const passwordStr = String(password || "");

  if (viaTelegram) {
    const tgFan = await getTelegramFan();
    if (!tgFan) {
      return NextResponse.json(
        { error: "Log in with Telegram first" },
        { status: 401 }
      );
    }
    const row = await telegramFanRow(tgFan.id);
    const username = row?.username ?? tgFan.username;
    tgName = username ? `@${username}` : row?.first_name || "Telegram user";
    emailStr = `tg-${tgFan.id}@telegram.fan`;
  } else {
    emailStr = String(email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(emailStr)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    if (passwordStr.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }
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

  const paidProfile = await ownerRequiresPaidSub(invite!.owner_id);

  if (existing) {
    // Telegram joins are already verified by the widget signature — no
    // password to check on resume.
    if (!viaTelegram && !verifyPassword(passwordStr, existing.guest_password || "")) {
      return NextResponse.json(
        { error: "This email is already registered, but the password is wrong" },
        { status: 403 }
      );
    }
    // Keep the device binding fresh so IP-based resume keeps working.
    // Free profiles follow immediately; paid ones follow only after payment.
    after(async () => {
      if (ip) {
        await db.from("chats").update({ guest_ip: ip }).eq("id", existing.id);
      }
      if (!paidProfile) {
        // Profile is free (again): a chat parked as pending from an earlier
        // paid sign-up becomes a normal visible chat.
        await db.from("chats").update({ pending: false }).eq("id", existing.id);
        await db
          .from("follows")
          .upsert(
            { chat_id: existing.id, owner_id: invite!.owner_id },
            { onConflict: "chat_id,owner_id", ignoreDuplicates: true }
          );
      }
    });
    const res = NextResponse.json({
      ok: true,
      chatId: existing.id,
      needsPayment: paidProfile,
    });
    res.cookies.set(
      GUEST_COOKIE,
      createToken({ chatId: existing.id, name: existing.guest_name }),
      cookieOptions
    );
    return res;
  }

  // The name typed at sign-up (or the Telegram identity); auto-generate one
  // only as a fallback.
  const guestName =
    (viaTelegram ? tgName || "" : String(name || "").trim()).slice(0, 40) ||
    `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
  const row = {
    owner_id: invite!.owner_id,
    invite_id: invite!.id,
    guest_name: guestName,
    guest_country: country,
    guest_ip: ip,
    guest_email: emailStr,
    // Telegram accounts have no password — store a random one so the row
    // can never be logged into with an empty string.
    guest_password: hashPassword(viaTelegram ? crypto.randomUUID() : passwordStr),
  };
  // Paid profiles: the chat stays pending (hidden from the creator's list)
  // until the fan finishes adding payment details.
  let { data: chat, error } = await db
    .from("chats")
    .insert({ ...row, pending: paidProfile })
    .select()
    .single();
  if (error && /pending/i.test(error.message)) {
    // Migration not applied yet — sign-ups must keep working.
    ({ data: chat, error } = await db.from("chats").insert(row).select().single());
  }
  if (error || !chat) {
    return NextResponse.json({ error: "Could not create chat" }, { status: 500 });
  }
  const chatId = chat.id as string;

  // Bookkeeping after the response is sent. Paid profiles defer follow +
  // welcome until the subscription is confirmed (see subscribe/activate).
  after(async () => {
    await db
      .from("invites")
      .update({ uses: (invite!.uses ?? 0) + 1 })
      .eq("id", invite!.id);

    // Timestamped signup row in the invite activity log.
    await recordInviteEvent({
      inviteId: invite!.id,
      kind: "signup",
      chatId,
      ip,
      country,
    });

    if (paidProfile) {
      // No "new-chat" ping yet — the chat is pending until the fan finishes
      // payment (revealPendingChat notifies the inbox on activation).
      return;
    }

    await db
      .from("follows")
      .upsert(
        { chat_id: chatId, owner_id: invite!.owner_id },
        { onConflict: "chat_id,owner_id", ignoreDuplicates: true }
      );
    await broadcast(`inbox:${invite!.owner_id}`, "new-chat", { chatId });
  });

  const res = NextResponse.json({
    ok: true,
    chatId,
    needsPayment: paidProfile,
  });
  res.cookies.set(GUEST_COOKIE, createToken({ chatId, name: guestName }), cookieOptions);
  return res;
}
