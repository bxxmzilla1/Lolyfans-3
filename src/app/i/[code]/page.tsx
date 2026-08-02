import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { inviteUsable, countryAllowed, ipFromHeaders, Invite } from "@/lib/invites";
import { recordInviteEvent } from "@/lib/inviteEvents";
import { resumeHrefForChatId } from "@/lib/guestResume";

export const dynamic = "force-dynamic";

/**
 * Invite links open the creator's locked profile preview directly (the old
 * customizable landing page is gone). This route still logs the click for
 * link analytics, resumes returning guests, and shows a short message when
 * the link is blocked (inactive / expired / geo-blocked).
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const db = supabaseAdmin();
  const requestHeaders = await headers();

  const guestChatId = await getGuestChatId();
  const visitorIp = ipFromHeaders(requestHeaders);

  const [cookieChat, ipChat, inviteRes] = await Promise.all([
    // Only resume an existing chat; a cookie left from a deleted chat must not
    // block a fresh invite (it would otherwise bounce the visitor to sign-in).
    guestChatId
      ? db.from("chats").select("id").eq("id", guestChatId).maybeSingle()
      : Promise.resolve(null),
    // No cookie (cleared history, different browser on the same device):
    // the device is remembered by IP, so drop them back into their chat.
    visitorIp
      ? db
          .from("chats")
          .select("id")
          .eq("guest_ip", visitorIp)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve(null),
    db.from("invites").select("*").eq("code", code).single<Invite>(),
  ]);
  if (cookieChat?.data) redirect(await resumeHrefForChatId(cookieChat.data.id));
  if (ipChat?.data) redirect("/api/resume");

  const invite = inviteRes.data;

  const country =
    requestHeaders.get("x-vercel-ip-country")?.toUpperCase() || null;

  // Count this visit as a link click (unique per IP; revisits are no-ops).
  // The visitor's country is stored with it so analytics can separate clicks
  // from allowed countries vs geo-blocked ones. Runs after the response is
  // sent so it never delays the redirect. Falls back to a country-less upsert
  // if the column hasn't been migrated yet.
  if (invite && visitorIp) {
    after(async () => {
      const { error } = await db
        .from("invite_visits")
        .upsert(
          { invite_id: invite.id, ip: visitorIp, country },
          { onConflict: "invite_id,ip", ignoreDuplicates: true }
        );
      if (error && /country/i.test(error.message)) {
        await db
          .from("invite_visits")
          .upsert(
            { invite_id: invite.id, ip: visitorIp },
            { onConflict: "invite_id,ip", ignoreDuplicates: true }
          );
      }
      // Full log: EVERY click gets its own timestamped row.
      await recordInviteEvent({
        inviteId: invite.id,
        kind: "click",
        ip: visitorIp,
        country,
      });
    });
  }

  const usable = inviteUsable(invite);
  const allowed = invite ? countryAllowed(invite.allowed_countries, country) : false;

  const blockedReason = !usable.ok
    ? usable.reason
    : !allowed
    ? "This chat link is not available in your country."
    : null;

  if (!blockedReason) redirect(`/i/${code}/profile`);

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 min-h-dvh">
      <div className="w-full max-w-sm text-center">
        <p className="text-muted text-sm whitespace-pre-wrap">{blockedReason}</p>
      </div>
    </main>
  );
}
