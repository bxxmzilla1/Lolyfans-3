import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ipFromHeaders } from "@/lib/invites";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { guestAccessDestination } from "@/lib/subscriptionAccess";

/**
 * Restores a returning guest's session by IP: if this visitor previously
 * joined a chat through an invite link, put them back into that chat —
 * or back onto the payment step when the creator's profile is still unpaid.
 */
export async function GET(req: NextRequest) {
  const ip = ipFromHeaders(req.headers);
  if (ip) {
    const { data: chat } = await supabaseAdmin()
      .from("chats")
      .select("id, guest_name, owner_id")
      .eq("guest_ip", ip)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (chat) {
      const dest = await guestAccessDestination(chat.id, chat.owner_id);
      const res = NextResponse.redirect(new URL(dest.href, req.nextUrl.origin));
      res.cookies.set(
        GUEST_COOKIE,
        createToken({ chatId: chat.id, name: chat.guest_name }),
        cookieOptions
      );
      return res;
    }
  }
  // No match: back to the landing page, skipping the IP lookup to avoid a loop.
  return NextResponse.redirect(new URL("/?resume=0", req.nextUrl.origin));
}
