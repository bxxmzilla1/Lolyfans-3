import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { ipFromHeaders } from "@/lib/invites";

/**
 * Logs a guest out: clears their session cookie and forgets this device's IP
 * so the app doesn't silently resume the chat on the next visit.
 */
export async function POST(req: NextRequest) {
  const ip = ipFromHeaders(req.headers);
  if (ip) {
    await supabaseAdmin().from("chats").update({ guest_ip: null }).eq("guest_ip", ip);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(GUEST_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}
