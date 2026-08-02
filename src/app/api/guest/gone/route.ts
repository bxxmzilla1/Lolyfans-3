import { NextRequest, NextResponse } from "next/server";
import { GUEST_COOKIE, cookieOptions } from "@/lib/session";

/**
 * The fan's chat no longer exists (the creator deleted it). Drop the stale
 * session cookie and drop them on lolyfans.com instead of leaving them stuck
 * on a chat screen or bouncing through the resume flow.
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", req.nextUrl.origin));
  res.cookies.set(GUEST_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}
