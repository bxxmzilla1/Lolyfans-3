import crypto from "crypto";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

const SECRET = process.env.AUTH_SECRET || "lolyfans-dev-secret-change-me";

export const GUEST_COOKIE = "loly_guest";

function sign(data: string) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function createToken(payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyToken<T>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

/**
 * The signed-in account's user id, or null when not signed in.
 * Uses getClaims() which verifies the JWT locally (cached JWKS) instead of
 * calling the Supabase auth server on every request.
 */
export async function getOwnerId(): Promise<string | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
}

/** Chat id from the guest cookie (people who joined via an invite link). */
export async function getGuestChatId(): Promise<string | null> {
  const store = await cookies();
  const payload = verifyToken<{ chatId?: string }>(store.get(GUEST_COOKIE)?.value);
  return payload?.chatId ?? null;
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};
