import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { getRequestCountry, ipFromHeaders, inviteUsable, countryAllowed } from "@/lib/invites";

export async function POST(req: NextRequest) {
  const { code, name } = await req.json();
  // Visitors no longer type a name — give them an auto-generated nickname.
  const guestName =
    String(name || "").trim().slice(0, 40) ||
    `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
  if (!code) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: invite } = await db
    .from("invites")
    .select("*")
    .eq("code", code)
    .single();

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

  // This device already has a chat (matched by IP)? Put them back into it
  // instead of creating a duplicate.
  const ip = ipFromHeaders(req.headers);
  if (ip) {
    const { data: previous } = await db
      .from("chats")
      .select("id, guest_name")
      .eq("guest_ip", ip)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previous) {
      const res = NextResponse.json({ ok: true, chatId: previous.id });
      res.cookies.set(
        GUEST_COOKIE,
        createToken({ chatId: previous.id, name: previous.guest_name }),
        cookieOptions
      );
      return res;
    }
  }

  const { data: chat, error } = await db
    .from("chats")
    .insert({
      owner_id: invite!.owner_id,
      invite_id: invite!.id,
      guest_name: guestName,
      guest_country: country,
      guest_ip: ip,
    })
    .select()
    .single();
  if (error || !chat) {
    return NextResponse.json({ error: "Could not create chat" }, { status: 500 });
  }

  await db
    .from("invites")
    .update({ uses: (invite!.uses ?? 0) + 1 })
    .eq("id", invite!.id);

  const res = NextResponse.json({ ok: true, chatId: chat.id });
  res.cookies.set(GUEST_COOKIE, createToken({ chatId: chat.id, name: guestName }), cookieOptions);
  return res;
}
