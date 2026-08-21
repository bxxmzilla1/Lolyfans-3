import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ipFromHeaders } from "@/lib/invites";
import { createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { guestAccessDestination } from "@/lib/subscriptionAccess";

/**
 * Restores a returning guest's session by IP: if this visitor previously
 * joined a chat through an invite link, put them back into that chat —
 * or back onto the payment step when the creator's profile is still unpaid.
 *
 * Optional `?next=/i/CODE/profile` keeps unpaid fans on the invite profile
 * (with the card sheet) instead of bouncing them to /signup.
 */
export async function GET(req: NextRequest) {
  const ip = ipFromHeaders(req.headers);
  const nextRaw = req.nextUrl.searchParams.get("next");
  // Only allow same-origin relative paths (invite profile / chat).
  const next =
    nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//")
      ? nextRaw
      : null;

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
      const href =
        !dest.allowed && next
          ? `${next}${next.includes("?") ? "&" : "?"}pay=1`
          : dest.href;
      const res = NextResponse.redirect(
        href.startsWith("http") ? href : new URL(href, req.nextUrl.origin)
      );
      res.cookies.set(
        GUEST_COOKIE,
        createToken({ chatId: chat.id, name: chat.guest_name }),
        cookieOptions
      );
      return res;
    }
  }
  // No match: back to the landing page, skipping the IP lookup to avoid a loop.
  return NextResponse.redirect(new URL(next || "/?resume=0", req.nextUrl.origin));
}
