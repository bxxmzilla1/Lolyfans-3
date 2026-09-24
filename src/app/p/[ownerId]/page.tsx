import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats, ownerProfiles } from "@/lib/guest";
import { applyUserGeoTokens, visitorGeoParts } from "@/lib/geo";
import { guestAccessDestination } from "@/lib/subscriptionAccess";
import { DEFAULT_WELCOME_TEXT } from "@/lib/chatWelcome";
import { mediaUrl } from "@/lib/utils";
import CreatorChatPreview from "@/components/CreatorChatPreview";
import SubscribeReturn from "@/components/SubscribeReturn";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opening a creator goes straight to their chat. Fans with an account land
 * in their conversation with this creator (started on the spot if needed);
 * visitors see the locked chat and must finish signing up to talk. On paid
 * profiles, fans who signed up but haven't added a card see the chat locked
 * with the card step instead.
 */
export default async function CreatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ ownerId: string }>;
  searchParams: Promise<{
    via?: string;
    subscribe?: string;
    subscribed?: string;
    sub?: string;
    pi?: string;
  }>;
}) {
  const [{ ownerId }, query] = await Promise.all([params, searchParams]);
  if (!UUID_RE.test(ownerId)) notFound();

  const requestHeaders = await headers();
  const chats = await guestChats(requestHeaders);
  const chatWithOwner = chats.find((c) => c.owner_id === ownerId) ?? null;

  // Ids Stripe appends to the return URL after a 3-D Secure redirect.
  const returnSubId = query.subscribed === "1" ? query.sub : undefined;
  const returnPiId = query.subscribed === "1" ? query.pi : undefined;
  const finishing = !!(returnSubId || returnPiId) && !!chatWithOwner;

  // Fan of this creator with access → their chat. The route handler sets the
  // session cookie and lands on /chat.
  let needsCard = false;
  if (chatWithOwner && !finishing) {
    const access = await guestAccessDestination(chatWithOwner.id, ownerId);
    if (access.allowed) redirect(`/api/guest/open?ownerId=${ownerId}`);
    needsCard = true;
  } else if (!chatWithOwner && chats.length > 0) {
    // Fan of someone else: start the chat with this creator. If the profile
    // is paid, /chat sends them back here with the card step open.
    redirect(`/api/guest/open?ownerId=${ownerId}`);
  }

  const db = supabaseAdmin();
  // Only plain codes/slugs — keeps the value safe inside the filter below.
  const via = /^[A-Za-z0-9_-]{1,64}$/.test(query.via || "") ? query.via! : "";
  const [profiles, geo, { data: viaInvite }, { data: latestInvite }] =
    await Promise.all([
      ownerProfiles([ownerId]),
      visitorGeoParts(requestHeaders),
      // The invite link they arrived through, if it's this creator's.
      via
        ? db
            .from("invites")
            .select("code")
            .eq("owner_id", ownerId)
            .eq("active", true)
            .or(`code.eq.${via},code.eq.${via.toLowerCase()}`)
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null as { code: string } | null }),
      // Otherwise the creator's newest active link.
      db
        .from("invites")
        .select("code")
        .eq("owner_id", ownerId)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const profile = profiles.get(ownerId);
  if (!profile) notFound();

  // Settings → Chat: the creator's opening message. CITYUSER / COUNTRYUSER
  // become this visitor's own location.
  const { welcome } = profile;
  const intro = welcome.text
    ? applyUserGeoTokens(welcome.text, geo)
    : welcome.mediaPath
      ? null
      : DEFAULT_WELCOME_TEXT;
  const media =
    welcome.mediaPath && welcome.mediaType
      ? {
          url: mediaUrl(welcome.mediaPath),
          type: welcome.mediaType,
          // Blurred until they're in: visitors, and on paid profiles fans
          // who still owe the card step.
          blurred: welcome.blur,
        }
      : null;

  return (
    <>
      {finishing && (
        <SubscribeReturn
          ownerId={ownerId}
          subscriptionId={returnSubId}
          paymentIntentId={returnPiId}
        />
      )}
      <CreatorChatPreview
        ownerId={ownerId}
        name={profile.name}
        avatarPath={profile.avatarPath}
        verified={profile.verified}
        intro={intro}
        media={media}
        plan={profile.plan}
        inviteCode={viaInvite?.code ?? latestInvite?.code ?? null}
        // Signed up, no card yet (paid profile): the sheet opens at the card
        // step — immediately when sent here by the paywall (?subscribe=1).
        cardOnly={needsCard}
        autoOpen={needsCard && query.subscribe === "1"}
      />
    </>
  );
}
