import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { inviteUsable, countryAllowed, ipFromHeaders, Invite } from "@/lib/invites";
import { visitorGeoParts } from "@/lib/geo";
import { mediaUrl } from "@/lib/utils";
import JoinForm from "@/components/JoinForm";
import InviteProfile from "@/components/InviteProfile";
import InviteTheme from "@/components/InviteTheme";

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
  const geo = await visitorGeoParts(requestHeaders);

  const blockedReason = !usable.ok
    ? usable.reason
    : !allowed
    ? "This chat link is not available in your country."
    : null;

  // The profile of whoever created this link + their invite page settings
  let ownerName = "Lolyfans";
  let avatarPath: string | null = null;
  let ownerTheme: "light" | "dark" = "dark";
  let verified = false;
  let descriptionTemplate = "";
  let buttonText = "";
  if (invite) {
    const { data: ownerUser } = await db.auth.admin.getUserById(invite.owner_id);
    const meta = (ownerUser?.user?.user_metadata ?? {}) as {
      display_name?: string;
      avatar_path?: string;
      theme?: string;
      invite_verified?: boolean;
      invite_description?: string;
      invite_button_text?: string;
    };
    ownerName = meta.display_name || "Lolyfans";
    avatarPath = meta.avatar_path || null;
    ownerTheme = meta.theme === "light" ? "light" : "dark";
    verified = !!meta.invite_verified;
    descriptionTemplate = meta.invite_description || "";
    buttonText = meta.invite_button_text || "";
  }

  // Build the shown description, swapping CITY / COUNTRY for the visitor's
  // real location (from ipinfo). Falls back to a default line.
  const description = (
    descriptionTemplate ||
    `${ownerName} invited you to a private chat. Start chatting — no sign-up needed.`
  )
    .replace(/COUNTRY/g, geo.country || "your country")
    .replace(/CITY/g, geo.city || "your city");

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 min-h-dvh">
      {/* Match the inviter's chosen theme on first paint (no flash) */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.classList.${
            ownerTheme === "light" ? "add" : "remove"
          }('light')`,
        }}
      />
      <InviteTheme theme={ownerTheme} />
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
        {!blockedReason && <JoinForm code={code} buttonText={buttonText} />}
      </div>
    </main>
  );
}
