import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { inviteUsable, countryAllowed, Invite } from "@/lib/invites";

export const dynamic = "force-dynamic";

/**
 * Legacy invite signup URL — invite links are pure redirects now, so this
 * just follows the link's own redirect_url (never the site main channel).
 */
export default async function InviteSignupPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const db = supabaseAdmin();
  const requestHeaders = await headers();

  const { data: invite } = await db
    .from("invites")
    .select("*")
    .eq("code", code)
    .maybeSingle<Invite>();

  const usable = inviteUsable(invite);
  const country =
    requestHeaders.get("x-vercel-ip-country")?.toUpperCase() || null;
  const allowed = invite
    ? countryAllowed(invite.allowed_countries, country)
    : false;
  if (!usable.ok || !allowed) redirect(`/i/${code}`);

  const dest = (invite?.redirect_url || "").trim();
  if (dest) redirect(dest);
  redirect(`/i/${code}`);
}
