import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { inviteUsable, countryAllowed, ipFromHeaders, Invite } from "@/lib/invites";
import { mediaUrl } from "@/lib/utils";
import JoinForm from "@/components/JoinForm";
import InviteProfile from "@/components/InviteProfile";

export const dynamic = "force-dynamic";

/**
 * Step 2 of an invite link: the sign-up page (name, email, password).
 * Reached from the invite page's "Start chatting" button.
 */
export default async function InviteSignupPage({
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
    // Already in a chat? Straight back in (same rules as the invite page).
    guestChatId
      ? db.from("chats").select("id").eq("id", guestChatId).maybeSingle()
      : Promise.resolve(null),
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
  if (cookieChat?.data) redirect("/chat");
  if (ipChat?.data) redirect("/api/resume");

  const invite = inviteRes.data;
  const usable = inviteUsable(invite);
  const country =
    requestHeaders.get("x-vercel-ip-country")?.toUpperCase() || null;
  const allowed = invite ? countryAllowed(invite.allowed_countries, country) : false;
  // Blocked links show their reason on the invite page itself.
  if (!usable.ok || !allowed) redirect(`/i/${code}`);

  const { data: ownerUser } = await db.auth.admin.getUserById(invite!.owner_id);
  const meta = (ownerUser?.user?.user_metadata ?? {}) as {
    display_name?: string;
    avatar_path?: string;
    invite_verified?: boolean;
    invite_button_text?: string;
  };
  const ownerName = meta.display_name || "Lolyfans";

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 min-h-dvh">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        <InviteProfile
          name={ownerName}
          avatarUrl={meta.avatar_path ? mediaUrl(meta.avatar_path) : null}
          verified={!!meta.invite_verified}
        />

        <div className="text-center -mt-2">
          <p className="text-muted text-sm">
            Sign up with your email to follow {ownerName} and start chatting.
          </p>
        </div>

        <JoinForm code={code} buttonText={meta.invite_button_text} />
      </div>
    </main>
  );
}
