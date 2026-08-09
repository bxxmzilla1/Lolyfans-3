import type { NextRequest } from "next/server";

export type Invite = {
  id: string;
  owner_id: string;
  code: string;
  label: string | null;
  allowed_countries: string[] | null;
  max_uses: number | null;
  uses: number;
  active: boolean;
  expires_at: string | null;
  created_at: string;
  /** Visitors from redirect_countries are sent here instead of the invite flow. */
  redirect_url?: string | null;
  redirect_countries?: string[] | null;
};

/** Country of the visitor, from Vercel's geo header. Null when unknown (e.g. localhost). */
export function getRequestCountry(req: NextRequest): string | null {
  return req.headers.get("x-vercel-ip-country")?.toUpperCase() || null;
}

/** Visitor IP from proxy headers. Null when unknown (e.g. localhost). */
export function ipFromHeaders(h: Headers): string | null {
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || null;
  return h.get("x-real-ip");
}

export function inviteUsable(invite: Invite | null | undefined): { ok: boolean; reason: string } {
  if (!invite || !invite.active) return { ok: false, reason: "This invite link is no longer active" };
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return { ok: false, reason: "This invite link has expired" };
  }
  if (invite.max_uses != null && invite.uses >= invite.max_uses) {
    return { ok: false, reason: "This invite link has reached its limit" };
  }
  return { ok: true, reason: "" };
}

export function countryAllowed(allowed: string[] | null, country: string | null): boolean {
  if (!allowed || allowed.length === 0) return true;
  // Unknown country (local dev / missing header): allow, Vercel always sets it in production.
  if (!country) return true;
  return allowed.map((c) => c.toUpperCase()).includes(country);
}

/**
 * Where to send this visitor instead of the invite flow, or null for the
 * normal flow. Only fires when the creator set BOTH a redirect URL and the
 * countries it applies to, and the visitor is from one of those countries.
 */
export function inviteRedirectFor(
  invite: Invite | null | undefined,
  country: string | null
): string | null {
  const url = invite?.redirect_url?.trim();
  const list = invite?.redirect_countries;
  if (!url || !list || list.length === 0 || !country) return null;
  return list.map((c) => c.toUpperCase()).includes(country) ? url : null;
}
