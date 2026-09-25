import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { getRequestCountry, ipFromHeaders, inviteUsable, countryAllowed } from "@/lib/invites";
import { broadcast } from "@/lib/realtime";
import { recordInviteEvent } from "@/lib/inviteEvents";
import { lookupIp } from "@/lib/ipinfo";
import { guestAccessDestination, ownerSubPlan } from "@/lib/subscriptionAccess";
import { notifyCrossCreatorSubscribe, notifySignup } from "@/lib/adminTelegram";
import { sendWelcomeMessage } from "@/lib/chatWelcome";
import { headerGeo } from "@/lib/geo";
import { shortWallet, verifyWalletSignIn } from "@/lib/walletAuth";

/**
 * Paid profile and no running trial / paid period? The client shows the
 * USDC payment step next (free-trial plans start the trial right here).
 */
async function accessStep(chatId: string, ownerId: string) {
  const [plan, access] = await Promise.all([
    ownerSubPlan(ownerId),
    guestAccessDestination(chatId, ownerId),
  ]);
  return {
    requiresPayment: !access.allowed,
    plan: {
      priceCents: plan.priceCents,
      interval: plan.interval,
      trialDays: plan.trialDays,
      discountPct: plan.discountPct,
    },
  };
}

/**
 * Creates (or resumes) a guest chat after "Continue with Phantom": the fan
 * signed the challenge, so the wallet address is their account. One chat per
 * wallet per creator.
 */
export async function POST(req: NextRequest) {
  const { code, publicKey, signature, challenge } = await req.json();

  if (!code) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }
  const wallet = verifyWalletSignIn({ publicKey, signature, challenge });
  if (!wallet) {
    return NextResponse.json(
      { error: "Wallet signature could not be verified — try again" },
      { status: 401 }
    );
  }

  const db = supabaseAdmin();
  const ip = ipFromHeaders(req.headers);

  const { data: invite } = await db.from("invites").select("*").eq("code", code).single();
  const usable = inviteUsable(invite);
  if (!usable.ok) {
    return NextResponse.json({ error: usable.reason }, { status: 403 });
  }

  // This wallet already has a chat with this creator? Resume it.
  const { data: existing } = await db
    .from("chats")
    .select("id, guest_name")
    .eq("owner_id", invite!.owner_id)
    .eq("guest_wallet", wallet)
    .maybeSingle();

  if (existing) {
    after(async () => {
      if (ip) {
        await db.from("chats").update({ guest_ip: ip }).eq("id", existing.id);
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
      ...(await accessStep(existing.id, invite!.owner_id)),
    });
    res.cookies.set(
      GUEST_COOKIE,
      createToken({ chatId: existing.id, name: existing.guest_name }),
      cookieOptions
    );
    return res;
  }

  const country = getRequestCountry(req);
  if (!countryAllowed(invite!.allowed_countries, country)) {
    return NextResponse.json(
      { error: "This chat link is not available in your country" },
      { status: 403 }
    );
  }

  // Same wallet already chatting with another creator? Reuse their name and
  // picture — this is an existing fan subscribing to one more creator.
  const { data: priorChat } = await db
    .from("chats")
    .select("owner_id, guest_name, guest_avatar_path")
    .eq("guest_wallet", wallet)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const guestName = (priorChat?.guest_name as string | null) || shortWallet(wallet);
  const { data: chat, error } = await db
    .from("chats")
    .insert({
      owner_id: invite!.owner_id,
      invite_id: invite!.id,
      guest_name: guestName,
      guest_avatar_path: (priorChat?.guest_avatar_path as string | null) ?? null,
      guest_country: country,
      guest_ip: ip,
      guest_wallet: wallet,
    })
    .select()
    .single();
  if (error || !chat) {
    const msg = /guest_wallet/i.test(error?.message || "")
      ? "Run supabase/migration-phantom-only.sql first"
      : "Could not create chat";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  const chatId = chat.id as string;

  // The creator's welcome message (Settings → Chat) is in place before the
  // chat opens, so it's there on first paint.
  await sendWelcomeMessage(chatId, invite!.owner_id, headerGeo(req.headers));

  after(async () => {
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

    if (priorChat) {
      await notifyCrossCreatorSubscribe(
        chatId,
        invite!.owner_id,
        priorChat.owner_id as string,
        `Creator link ${invite!.label || invite!.code}`
      );
    } else {
      await notifySignup(chatId, invite!.owner_id, {
        label: invite!.label,
        code: invite!.code,
      });
    }
  });

  const res = NextResponse.json({
    ok: true,
    created: true, // brand-new chat → conversion pixel fires
    chatId,
    ownerId: invite!.owner_id,
    ...(await accessStep(chatId, invite!.owner_id)),
  });
  res.cookies.set(GUEST_COOKIE, createToken({ chatId, name: guestName }), cookieOptions);
  return res;
}
