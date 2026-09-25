import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { ipFromHeaders } from "@/lib/invites";
import { guestChats } from "@/lib/guest";

/**
 * Logs a guest out: clears their session cookie and forgets this device —
 * its IP and device id — on every chat of theirs, so no browser on the phone
 * silently signs them back in.
 */
export async function POST(req: NextRequest) {
  const db = supabaseAdmin();
  const chats = await guestChats(req.headers);
  const ids = chats.map((c) => c.id);
  if (ids.length) {
    const { error } = await db
      .from("chats")
      .update({ guest_ip: null, guest_device: null })
      .in("id", ids);
    if (error && /guest_device/i.test(error.message)) {
      await db.from("chats").update({ guest_ip: null }).in("id", ids);
    }
  }
  const ip = ipFromHeaders(req.headers);
  if (ip) {
    await db.from("chats").update({ guest_ip: null }).eq("guest_ip", ip);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(GUEST_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}
