import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats, ownerProfiles } from "@/lib/guest";
import { applyUserGeoTokens, visitorGeoParts } from "@/lib/geo";
import CreatorChatPreview from "@/components/CreatorChatPreview";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opening a creator goes straight to their chat. Fans with an account land
 * in their conversation with this creator (started on the spot if needed);
 * visitors see the locked chat and must finish signing up to talk.
 */
export default async function CreatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ ownerId: string }>;
  searchParams: Promise<{ via?: string }>;
}) {
  const [{ ownerId }, query] = await Promise.all([params, searchParams]);
  if (!UUID_RE.test(ownerId)) notFound();

  const requestHeaders = await headers();
  const chats = await guestChats(requestHeaders);

  // Already a fan of someone: open (or start) the chat with this creator.
  // The route handler sets the session cookie and lands on /chat.
  if (chats.length > 0) {
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

  // CITYUSER / COUNTRYUSER in the bio become this visitor's own location.
  const intro = profile.bio
    ? applyUserGeoTokens(profile.bio, geo)
    : `Hey, welcome to my private chat. Sign up and say hi!`;

  return (
    <CreatorChatPreview
      ownerId={ownerId}
      name={profile.name}
      avatarPath={profile.avatarPath}
      verified={profile.verified}
      intro={intro}
      inviteCode={viaInvite?.code ?? latestInvite?.code ?? null}
    />
  );
}
