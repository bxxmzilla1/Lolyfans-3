import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { inviteUsable, countryAllowed, ipFromHeaders, Invite } from "@/lib/invites";
import { visitorLocation } from "@/lib/geo";
import { mediaUrl } from "@/lib/utils";
import JoinForm from "@/components/JoinForm";
import InviteProfile from "@/components/InviteProfile";
import { IconMapPin } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const db = supabaseAdmin();
  const requestHeaders = await headers();

  // Only resume an existing chat; a cookie left from a deleted chat must not
  // block a fresh invite (it would otherwise bounce the visitor to sign-in).
  const guestChatId = await getGuestChatId();
  if (guestChatId) {
    const { data: existing } = await db
      .from("chats")
      .select("id")
      .eq("id", guestChatId)
      .maybeSingle();
    if (existing) redirect("/chat");
  }

  // No cookie (cleared history, different browser on the same device):
  // the device is remembered by IP, so drop them back into their chat.
  const visitorIp = ipFromHeaders(requestHeaders);
  if (visitorIp) {
    const { data: previous } = await db
      .from("chats")
      .select("id")
      .eq("guest_ip", visitorIp)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previous) redirect("/api/resume");
  }

  const { data: invite } = await db
    .from("invites")
    .select("*")
    .eq("code", code)
    .single<Invite>();

  // Count this visit as a link click (unique per IP; revisits are no-ops).
  if (invite && visitorIp) {
    await db
      .from("invite_visits")
      .upsert(
        { invite_id: invite.id, ip: visitorIp },
        { onConflict: "invite_id,ip", ignoreDuplicates: true }
      );
  }

  const usable = inviteUsable(invite);
  const country =
    requestHeaders.get("x-vercel-ip-country")?.toUpperCase() || null;
  const allowed = invite ? countryAllowed(invite.allowed_countries, country) : false;
  const location = await visitorLocation(requestHeaders);

  const blockedReason = !usable.ok
    ? usable.reason
    : !allowed
    ? "This chat link is not available in your country."
    : null;

  // The profile of whoever created this link
  let ownerName = "Lolyfans";
  let avatarPath: string | null = null;
  if (invite) {
    const { data: ownerUser } = await db.auth.admin.getUserById(invite.owner_id);
    const meta = (ownerUser?.user?.user_metadata ?? {}) as {
      display_name?: string;
      avatar_path?: string;
    };
    ownerName = meta.display_name || "Lolyfans";
    avatarPath = meta.avatar_path || null;
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 min-h-dvh">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        {location && (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-card2 border border-line px-3 py-1.5 text-xs text-muted">
            <IconMapPin className="w-3.5 h-3.5 text-accent" />
            {location}
          </p>
        )}
        <InviteProfile
          name={ownerName}
          avatarUrl={avatarPath ? mediaUrl(avatarPath) : null}
        />

        <div className="text-center -mt-2">
          <p className="text-muted text-sm">
            {blockedReason
              ? blockedReason
              : `${ownerName} invited you to a private chat. Pick a name and start chatting — no sign-up needed.`}
          </p>
        </div>
        {!blockedReason && (
          <JoinForm
            code={code}
            inviterName={ownerName}
            avatarUrl={avatarPath ? mediaUrl(avatarPath) : null}
          />
        )}
      </div>
    </main>
  );
}
