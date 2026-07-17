import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { inviteUsable, countryAllowed, Invite } from "@/lib/invites";
import JoinForm from "@/components/JoinForm";
import { IconChat } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  if (await getGuestChatId()) redirect("/chat");
  const { code } = await params;

  const { data: invite } = await supabaseAdmin()
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

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 min-h-dvh">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        <div className="w-20 h-20 rounded-3xl ig-gradient glow-accent flex items-center justify-center">
          <IconChat className="w-10 h-10 text-white" />
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-bold ig-gradient-text">Lolyfans</h1>
          <p className="text-muted text-sm mt-2">
            {blockedReason
              ? blockedReason
              : "You've been invited to a private chat. Pick a name and start chatting — no sign-up needed."}
          </p>
        </div>
        {!blockedReason && <JoinForm code={code} />}
      </div>
    </main>
  );
}
