import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { getRequestCountry, ipFromHeaders, inviteUsable, countryAllowed } from "@/lib/invites";
import { hashPassword, verifyPassword } from "@/lib/password";
import { broadcast } from "@/lib/realtime";
import { recordInviteEvent } from "@/lib/inviteEvents";
import { lookupIp } from "@/lib/ipinfo";
import {
  guestAccessDestination,
  inheritVerifiedCard,
  ownerSubPlan,
} from "@/lib/subscriptionAccess";
import { notifySignup } from "@/lib/adminTelegram";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Paid profile and no verified card yet? The client shows the card step
 * next. A card verified with any other creator (same email) counts and is
 * copied over, so those fans go straight to the chat.
 */
async function cardStep(chatId: string, ownerId: string, guestEmail: string) {
  // Verified card with another creator? Copy it here first — for free
  // profiles too — so the fan shows up in this creator's inbox and one-tap
  // purchases work right away (also pings the admin bot).
  await inheritVerifiedCard(chatId, guestEmail);
  const [plan, access] = await Promise.all([
    ownerSubPlan(ownerId),
    guestAccessDestination(chatId, ownerId),
  ]);
  return {
    requiresCard: !access.allowed,
    plan: {
      priceCents: plan.priceCents,
      interval: plan.interval,
      trialDays: plan.trialDays,
      discountPct: plan.discountPct,
    },
  };
}

/**
 * Creates (or resumes) a guest chat after sign-up. Name + email + password;
 * paid profiles then collect a card (see cardStep) before the chat opens.
 */
export async function POST(req: NextRequest) {
  const { code, name, email, password } = await req.json();

  if (!code) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }
  const nameStr = String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!nameStr) {
    return NextResponse.json({ error: "Enter your name" }, { status: 400 });
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
    after(async () => {
      // Keep the display name fresh — older accounts were auto-named from the
      // email local-part, so the typed name is always better.
      if (nameStr && nameStr !== existing.guest_name) {
        await db.from("chats").update({ guest_name: nameStr }).eq("id", existing.id);
      }
      if (ip) {
        await db.from("chats").update({ guest_ip: ip }).eq("id", existing.id);
        // Refresh the fan's location (ipinfo) so the inbox shows where they are.
        const geo = await lookupIp(ip);
        if (geo?.city) {
          await db
            .from("chats")
            .update({
              guest_city: geo.city,
              ...(geo.country ? { guest_country: geo.country } : {}),
            })
            .eq("id", existing.id);
        }
      }
      // Clear any leftover pending flag from the old paid-sub flow.
      await db.from("chats").update({ pending: false }).eq("id", existing.id);
      await db
        .from("follows")
        .upsert(
          { chat_id: existing.id, owner_id: invite!.owner_id },
          { onConflict: "chat_id,owner_id", ignoreDuplicates: true }
        );
    });
    const res = NextResponse.json({
      ok: true,
      created: false, // returning fan — not a new registration
      chatId: existing.id,
      ownerId: invite!.owner_id,
      ...(await cardStep(existing.id, invite!.owner_id, emailStr)),
    });
    res.cookies.set(
      GUEST_COOKIE,
      createToken({ chatId: existing.id, name: nameStr || existing.guest_name }),
      cookieOptions
    );
    return res;
  }

  const guestName = nameStr;

  const row = {
    owner_id: invite!.owner_id,
    invite_id: invite!.id,
    guest_name: guestName,
    guest_country: country,
    guest_ip: ip,
    guest_email: emailStr,
    guest_password: hashPassword(passwordStr),
    pending: false,
  };
  let { data: chat, error } = await db.from("chats").insert(row).select().single();
  if (error && /pending/i.test(error.message)) {
    const { pending: _ignored, ...withoutPending } = row;
    void _ignored;
    ({ data: chat, error } = await db
      .from("chats")
      .insert(withoutPending)
      .select()
      .single());
  }
  if (error || !chat) {
    return NextResponse.json({ error: "Could not create chat" }, { status: 500 });
  }
  const chatId = chat.id as string;

  after(async () => {
    // Geo-locate the new fan through ipinfo so their city shows up next to
    // their name in the creator's inbox and chat header.
    if (ip) {
      const geo = await lookupIp(ip);
      if (geo?.city || geo?.country) {
        await db
          .from("chats")
          .update({
            ...(geo.city ? { guest_city: geo.city } : {}),
            ...(geo.country ? { guest_country: geo.country } : {}),
          })
          .eq("id", chatId);
      }
    }

    await db
      .from("invites")
      .update({ uses: (invite!.uses ?? 0) + 1 })
      .eq("id", invite!.id);

    await recordInviteEvent({
      inviteId: invite!.id,
      kind: "signup",
      chatId,
      ip,
      country,
    });

    await db
      .from("follows")
      .upsert(
        { chat_id: chatId, owner_id: invite!.owner_id },
        { onConflict: "chat_id,owner_id", ignoreDuplicates: true }
      );
    await broadcast(`inbox:${invite!.owner_id}`, "new-chat", { chatId });

    // Admin bot: new account. Runs after the geo lookup above so the
    // message carries the fan's location.
    await notifySignup(chatId, invite!.owner_id, {
      label: invite!.label,
      code: invite!.code,
    });
  });

  const res = NextResponse.json({
    ok: true,
    created: true, // brand-new account → conversion pixel fires
    chatId,
    ownerId: invite!.owner_id,
    ...(await cardStep(chatId, invite!.owner_id, emailStr)),
  });
  res.cookies.set(GUEST_COOKIE, createToken({ chatId, name: guestName }), cookieOptions);
  return res;
}
