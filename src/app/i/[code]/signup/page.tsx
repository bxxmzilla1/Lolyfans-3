import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { inviteUsable, countryAllowed, ipFromHeaders, Invite } from "@/lib/invites";
import { mediaUrl } from "@/lib/utils";
import { subPlanFromMetadata } from "@/lib/subscriptionPlan";
import {
  chatHasPaidAccess,
  ownerRequiresPaidSub,
} from "@/lib/subscriptionAccess";
import JoinForm from "@/components/JoinForm";
import InviteProfile from "@/components/InviteProfile";

export const dynamic = "force-dynamic";

/**
 * Step 2 of an invite link: the sign-up page (name, email, password).
 * Paid profiles keep unpaid guests here on the card step — they never
 * skip into /chat until the subscription is confirmed.
 */
export default async function InviteSignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ pay?: string }>;
}) {
  const { code } = await params;
  const { pay } = await searchParams;
  const db = supabaseAdmin();
  const requestHeaders = await headers();

  const guestChatId = await getGuestChatId();
  const visitorIp = ipFromHeaders(requestHeaders);

  const [cookieChat, ipChat, inviteRes] = await Promise.all([
    guestChatId
      ? db
          .from("chats")
          .select("id, owner_id")
          .eq("id", guestChatId)
          .maybeSingle()
      : Promise.resolve(null),
    visitorIp
      ? db
          .from("chats")
          .select("id, owner_id")
          .eq("guest_ip", visitorIp)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve(null),
    db.from("invites").select("*").eq("code", code).single<Invite>(),
  ]);

  const invite = inviteRes.data;
  const usable = inviteUsable(invite);
  const country =
    requestHeaders.get("x-vercel-ip-country")?.toUpperCase() || null;
  const allowed = invite ? countryAllowed(invite.allowed_countries, country) : false;
  if (!usable.ok || !allowed) redirect(`/i/${code}`);

  const existingChat = cookieChat?.data ?? ipChat?.data ?? null;
  let forcePayStep = pay === "1";

  if (existingChat) {
    const paidOk =
      !(await ownerRequiresPaidSub(existingChat.owner_id)) ||
      (await chatHasPaidAccess(existingChat.id, existingChat.owner_id));
    if (paidOk) redirect("/chat");
    // Signed up but hasn't paid yet → stay here and show the card form.
    forcePayStep = true;
  }

  const { data: ownerUser } = await db.auth.admin.getUserById(invite!.owner_id);
  const meta = (ownerUser?.user?.user_metadata ?? {}) as {
    display_name?: string;
    avatar_path?: string;
    invite_verified?: boolean;
    invite_button_text?: string;
  };
  const ownerName = meta.display_name || "Lolyfans";
  const plan = subPlanFromMetadata(meta as Record<string, unknown>);

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
            {forcePayStep && plan.priceCents > 0
              ? `Complete your subscription to chat with ${ownerName}.`
              : `Sign up with your email to subscribe to ${ownerName} and start chatting.`}
          </p>
        </div>

        <JoinForm
          code={code}
          buttonText={meta.invite_button_text}
          ownerId={invite!.owner_id}
          ownerName={ownerName}
          plan={plan}
          initialPayStep={forcePayStep && plan.priceCents > 0}
        />
      </div>
    </main>
  );
}
