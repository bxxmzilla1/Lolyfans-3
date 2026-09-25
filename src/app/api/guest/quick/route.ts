import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";
import {
  countryAllowed,
  getRequestCountry,
  inviteSignupRequired,
  inviteUsable,
  ipFromHeaders,
  type Invite,
} from "@/lib/invites";
import { guestChats, type GuestChat } from "@/lib/guest";
import { ensureGuestChatWith } from "@/lib/guestChatWith";
import { deviceHash, findChatByDevice, rememberDevice, type DeviceTraits } from "@/lib/guestDevice";
import { guestAccessDestination, ownerSubPlan } from "@/lib/subscriptionAccess";
import { lookupIp } from "@/lib/ipinfo";
import { recordInviteEvent } from "@/lib/inviteEvents";
import { broadcast } from "@/lib/realtime";
import { sendWelcomeMessage } from "@/lib/chatWelcome";
import { headerGeo } from "@/lib/geo";
import { notifySignup } from "@/lib/adminTelegram";

const CHAT_COLUMNS =
  "id, owner_id, guest_name, guest_email, guest_avatar_path, guest_last_read_at, last_message_at";

/**
 * Invite links with sign-up turned off: POST { code, traits } starts (or
 * resumes) the visitor's chat with no form. Returning fans are recognised by
 * session, IP or device; everyone else gets a fresh chat and their device is
 * remembered so every browser on the phone stays signed in.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    code?: string;
    traits?: DeviceTraits;
  };
  const code = String(body.code || "").trim();
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  const db = supabaseAdmin();
  let { data: invite } = await db
    .from("invites")
    .select("*")
    .eq("code", code)
    .maybeSingle<Invite>();
  if (!invite && code !== code.toLowerCase()) {
    ({ data: invite } = await db
      .from("invites")
      .select("*")
      .eq("code", code.toLowerCase())
      .maybeSingle<Invite>());
  }
  const usable = inviteUsable(invite);
  if (!invite || !usable.ok) {
    return NextResponse.json({ error: usable.reason || "Invite not found" }, { status: 404 });
  }
  if (inviteSignupRequired(invite)) {
    return NextResponse.json({ error: "This link requires sign-up" }, { status: 403 });
  }
  const country = getRequestCountry(req);
  if (!countryAllowed(invite.allowed_countries, country)) {
    return NextResponse.json(
      { error: "This link is not available in your country." },
      { status: 403 }
    );
  }

  const ownerId = invite.owner_id;
  const ip = ipFromHeaders(req.headers);
  const device = deviceHash(body.traits, req.headers);

  // Already known: session / IP / email, then this device.
  let chats = await guestChats(req.headers);
  if (!chats.length && device) {
    const match = await findChatByDevice(device, req.headers);
    if (match) {
      const { data } = await db.from("chats").select(CHAT_COLUMNS).eq("id", match.id);
      chats = (data as GuestChat[]) ?? [];
    }
  }
  if (chats.length) {
    const opened = await ensureGuestChatWith(ownerId, chats);
    if (opened) {
      if (device) await rememberDevice([opened.chat.id], device, ip);
      return withSession(
        NextResponse.json({ ok: true, created: false, ...(await access(opened.chat.id, ownerId)) }),
        opened.chat
      );
    }
  }

  // Brand-new fan: a chat with a placeholder name they can change in Profile.
  const guestName = `Fan ${Math.floor(1000 + Math.random() * 9000)}`;
  const row: Record<string, unknown> = {
    owner_id: ownerId,
    invite_id: invite.id,
    guest_name: guestName,
    guest_country: country,
    guest_ip: ip,
    guest_device: device,
    pending: false,
  };
  let { data: chat, error } = await db.from("chats").insert(row).select(CHAT_COLUMNS).single();
  // Columns from newer migrations may not exist yet — retry without them.
  if (error && /guest_device|pending/i.test(error.message)) {
    const { guest_device: _d, pending: _p, ...legacy } = row;
    void _d;
    void _p;
    ({ data: chat, error } = await db.from("chats").insert(legacy).select(CHAT_COLUMNS).single());
  }
  if (error || !chat) {
    return NextResponse.json({ error: "Could not start the chat" }, { status: 500 });
  }
  const chatId = chat.id as string;
  await sendWelcomeMessage(chatId, ownerId, headerGeo(req.headers));

  after(async () => {
    const geo = ip ? await lookupIp(ip) : null;
    if (geo?.city || geo?.country) {
      await db
        .from("chats")
        .update({
          ...(geo.city ? { guest_city: geo.city } : {}),
          ...(geo.country ? { guest_country: geo.country } : {}),
        })
        .eq("id", chatId);
    }
    await db
      .from("invites")
      .update({ uses: (invite!.uses ?? 0) + 1 })
      .eq("id", invite!.id);
    await recordInviteEvent({ inviteId: invite!.id, kind: "signup", chatId, ip, country });
    await db
      .from("follows")
      .upsert({ chat_id: chatId, owner_id: ownerId }, { onConflict: "chat_id,owner_id", ignoreDuplicates: true });
    await broadcast(`inbox:${ownerId}`, "new-chat", { chatId });
    await notifySignup(chatId, ownerId, {
      label: `${invite!.label || invite!.code} (no sign-up)`,
      code: invite!.code,
    });
  });

  return withSession(
    NextResponse.json({ ok: true, created: true, ...(await access(chatId, ownerId)) }),
    chat as GuestChat
  );
}

/** Card step needed (paid profile)? Plus the plan, for the Meta Pixel. */
async function access(chatId: string, ownerId: string) {
  const [plan, dest] = await Promise.all([
    ownerSubPlan(ownerId),
    guestAccessDestination(chatId, ownerId),
  ]);
  return {
    ownerId,
    requiresCard: !dest.allowed,
    plan: {
      priceCents: plan.priceCents,
      interval: plan.interval,
      trialDays: plan.trialDays,
      discountPct: plan.discountPct,
    },
  };
}

function withSession(res: NextResponse, chat: Pick<GuestChat, "id" | "guest_name">) {
  res.cookies.set(
    GUEST_COOKIE,
    createToken({ chatId: chat.id, name: chat.guest_name }),
    cookieOptions
  );
  return res;
}
