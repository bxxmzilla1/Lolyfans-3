import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { inviteUsable, countryAllowed, Invite } from "@/lib/invites";
import { mediaUrl } from "@/lib/utils";
import JoinForm from "@/components/JoinForm";
import { IconUser } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  if (await getGuestChatId()) redirect("/chat");
  const { code } = await params;

  const db = supabaseAdmin();
  const { data: invite } = await db
    .from("invites")
    .select("*")
    .eq("code", code)
    .single<Invite>();

  const usable = inviteUsable(invite);
  const country =
    (await headers()).get("x-vercel-ip-country")?.toUpperCase() || null;
  const allowed = invite ? countryAllowed(invite.allowed_countries, country) : false;

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

  // Rendered fresh on every visit: reads as recently active without live presence
  const minutesAgo = 2 + Math.floor(Math.random() * 4); // 2-5

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 min-h-dvh">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        <div className="relative">
          <div className="ig-ring">
            {avatarPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl(avatarPath)}
                alt={ownerName}
                className="w-24 h-24 rounded-full object-cover bg-bg"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-bg flex items-center justify-center">
                <IconUser className="w-10 h-10 text-muted" />
              </div>
            )}
          </div>
          <span className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-green-500 border-4 border-bg" />
        </div>

        <div className="text-center">
          <h1 className="text-2xl font-bold">{ownerName}</h1>
          <p className="text-green-400 text-xs font-medium mt-1">
            Online {minutesAgo} minutes ago
          </p>
          <p className="text-muted text-sm mt-3">
            {blockedReason
              ? blockedReason
              : `${ownerName} invited you to a private chat. Pick a name and start chatting — no sign-up needed.`}
          </p>
        </div>
        {!blockedReason && <JoinForm code={code} />}
      </div>
    </main>
  );
}
