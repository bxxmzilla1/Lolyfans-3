import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { inviteUsable, countryAllowed, ipFromHeaders, Invite } from "@/lib/invites";
import { visitorGeoParts } from "@/lib/geo";
import { mediaUrl } from "@/lib/utils";
import InviteProfile from "@/components/InviteProfile";
import { resumeHrefForChatId } from "@/lib/guestResume";

export const dynamic = "force-dynamic";

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

  // Everything the page needs, fetched at once instead of one after another.
  const [cookieChat, ipChat, inviteRes, geo] = await Promise.all([
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
    visitorGeoParts(requestHeaders),
  ]);
  if (cookieChat?.data) redirect(await resumeHrefForChatId(cookieChat.data.id));
  if (ipChat?.data) redirect("/api/resume");

  const invite = inviteRes.data;

  const country =
    requestHeaders.get("x-vercel-ip-country")?.toUpperCase() || null;

  // Count this visit as a link click (unique per IP; revisits are no-ops).
  // The visitor's country is stored with it so analytics can separate clicks
  // from allowed countries vs geo-blocked ones. Runs after the response is
  // sent so it never delays the page. Falls back to a country-less upsert if
  // the column hasn't been migrated yet.
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
    });
  }

  const usable = inviteUsable(invite);
  const allowed = invite ? countryAllowed(invite.allowed_countries, country) : false;

  const blockedReason = !usable.ok
    ? usable.reason
    : !allowed
    ? "This chat link is not available in your country."
    : null;

  // Links set to skip the landing page drop the visitor straight on the
  // creator's locked profile preview (the click was already registered above;
  // the preview registers it too for visitors who land there directly).
  if (invite?.skip_landing && !blockedReason) redirect(`/i/${code}/profile`);

  // The profile of whoever created this link + their invite page settings
  let ownerName = "Lolyfans";
  let avatarPath: string | null = null;
  let verified = false;
  let descriptionTemplate = "";
  let buttonText = "";
  if (invite) {
    const { data: ownerUser } = await db.auth.admin.getUserById(invite.owner_id);
    const meta = (ownerUser?.user?.user_metadata ?? {}) as {
      display_name?: string;
      avatar_path?: string;
      invite_verified?: boolean;
      invite_description?: string;
      invite_button_text?: string;
    };
    ownerName = meta.display_name || "Lolyfans";
    avatarPath = meta.avatar_path || null;
    verified = !!meta.invite_verified;
    descriptionTemplate = meta.invite_description || "";
    buttonText = meta.invite_button_text || "";
  }

  // Build the shown description, swapping CITY / COUNTRY for the visitor's
  // real location (from ipinfo). Falls back to a default line.
  const description = (
    descriptionTemplate ||
    `${ownerName} invited you to a private chat. Sign up to start chatting.`
  )
    .replace(/COUNTRY/g, geo.country || "your country")
    .replace(/CITY/g, geo.city || "your city");

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 min-h-dvh">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        <InviteProfile
          name={ownerName}
          avatarUrl={avatarPath ? mediaUrl(avatarPath) : null}
          verified={verified}
        />

        <div className="text-center -mt-2">
          <p className="text-muted text-sm whitespace-pre-wrap">
            {blockedReason ? blockedReason : description}
          </p>
        </div>
        {!blockedReason && (
          <Link
            href={`/i/${code}/profile`}
            className="w-full bg-accent text-white font-semibold rounded-xl py-3 text-center active:opacity-80 transition-opacity"
          >
            {buttonText?.trim() || "Start chatting"}
          </Link>
        )}
      </div>
    </main>
  );
}
