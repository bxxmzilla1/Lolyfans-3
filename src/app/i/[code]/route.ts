import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  inviteUsable,
  countryAllowed,
  ipFromHeaders,
  Invite,
} from "@/lib/invites";
import { recordInviteEvent } from "@/lib/inviteEvents";
import { lookupIp } from "@/lib/ipinfo";

export const dynamic = "force-dynamic";

/**
 * Invite links are pure redirect links: allowed visitors get an instant 307
 * to the creator's assigned URL. This is a route handler (not a page) on
 * purpose — the browser receives only the redirect, so no Lolyfans layout or
 * background ever flashes. Clicks are still logged for the link stats.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const db = supabaseAdmin();

  const { data: invite } = await db
    .from("invites")
    .select("*")
    .eq("code", code)
    .maybeSingle<Invite>();

  const country = req.headers.get("x-vercel-ip-country")?.toUpperCase() || null;
  const visitorIp = ipFromHeaders(req.headers);

  // Count this visit as a link click (unique per IP), geo-locate it through
  // ipinfo for the Visitors popup, plus a timestamped row for the full log.
  // Runs after the response is sent so it never delays the redirect.
  if (invite && visitorIp) {
    after(async () => {
      const geo = await lookupIp(visitorIp);
      const { error } = await db.from("invite_visits").upsert(
        {
          invite_id: invite.id,
          ip: visitorIp,
          country: geo?.country || country,
          city: geo?.city ?? null,
          region: geo?.region ?? null,
          org: geo?.org ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "invite_id,ip" }
      );
      if (error) {
        // Geo columns missing before the migration — keep the click count.
        await db
          .from("invite_visits")
          .upsert(
            { invite_id: invite.id, ip: visitorIp, country },
            { onConflict: "invite_id,ip", ignoreDuplicates: true }
          )
          .then(async (r) => {
            if (r.error) {
              await db.from("invite_visits").upsert(
                { invite_id: invite.id, ip: visitorIp },
                { onConflict: "invite_id,ip", ignoreDuplicates: true }
              );
            }
          });
      }
      await recordInviteEvent({
        inviteId: invite.id,
        kind: "click",
        ip: visitorIp,
        country: geo?.country || country,
      });
    });
  }

  const usable = inviteUsable(invite);
  if (!usable.ok) return blocked(usable.reason);
  if (!countryAllowed(invite!.allowed_countries, country)) {
    return blocked("This link is not available in your country.");
  }

  const url = (invite!.redirect_url || "").trim();
  // Legacy links created before redirect links became mandatory.
  if (!url) return blocked("This invite link is no longer active");

  return NextResponse.redirect(url, 307);
}

/** Tiny self-contained dark page — no app layout, loads instantly. */
function blocked(message: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Link unavailable</title>
<style>
  body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
    background:#0a0a0f;color:#9ca3af;font:14px/1.5 system-ui,-apple-system,sans-serif;
    text-align:center;padding:24px}
</style>
</head>
<body><p>${escapeHtml(message)}</p></body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
