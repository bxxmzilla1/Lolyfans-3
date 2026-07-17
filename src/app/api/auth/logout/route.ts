import { NextResponse } from "next/server";
import { GUEST_COOKIE } from "@/lib/session";

/** Clears the guest chat cookie. Account sign-out happens client-side via Supabase. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(GUEST_COOKIE);
  return res;
}
