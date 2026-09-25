import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats, ownerProfiles } from "@/lib/guest";
import { postStats } from "@/lib/posts";
import { applyUserGeoTokens, visitorGeoParts, visitorLocation } from "@/lib/geo";
import { formatCount, mediaUrl } from "@/lib/utils";
import { guestAccessDestination } from "@/lib/subscriptionAccess";
import GuestPage from "@/components/GuestPage";
import FollowButton from "@/components/FollowButton";
import ProfileSubscribeCta from "@/components/ProfileSubscribeCta";
import SubscribeReturn from "@/components/SubscribeReturn";
import MessageCreatorButton from "@/components/MessageCreatorButton";
import PostFeed, { type FeedPost } from "@/components/PostFeed";
import CreatorBanner from "@/components/CreatorBanner";
import { IconHeart, IconMapPin, IconVerified } from "@/components/Icons";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A creator's public profile: OnlyFans-style feed with likes and comments. */
export default async function CreatorProfilePage({
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
  const openCardSheet = query.subscribe === "1";
  // Ids Stripe appends to the return URL after a 3-D Secure redirect.
  const returnSubId = query.subscribed === "1" ? query.sub : undefined;
  const returnPiId = query.subscribed === "1" ? query.pi : undefined;
  if (!UUID_RE.test(ownerId)) notFound();

  const requestHeaders = await headers();
  const db = supabaseAdmin();
  // Invite link the visitor arrived through (/i/<code> adds ?via=), so the
  // sign-up is credited to it. Plain codes only — safe inside the filter.
  const via = /^[A-Za-z0-9_-]{1,64}$/.test(query.via || "") ? query.via! : "";

  const [profiles, chats, { data: posts }, location, geo, { data: latestInvite }, { data: viaInvite }] =
    await Promise.all([
      ownerProfiles([ownerId]),
      guestChats(requestHeaders),
      db
        .from("posts")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(90),
      visitorLocation(requestHeaders),
      visitorGeoParts(requestHeaders),
      // Latest active invite: lets visitors without an account register
      // straight from the profile via the SUBSCRIBE button.
      db
        .from("invites")
        .select("code")
        .eq("owner_id", ownerId)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
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
    ]);
  const invite = viaInvite ?? latestInvite;

  const profile = profiles.get(ownerId);
  if (!profile) notFound();
  // CITYUSER / COUNTRYUSER in the bio become this visitor's own location.
  const bio = profile.bio ? applyUserGeoTokens(profile.bio, geo) : null;

  const chatIds = chats.map((c) => c.id);
  const postIds = (posts ?? []).map((p) => p.id);
  const stats = await postStats(postIds, chatIds);

  // Is this guest already following (free) / subscribed (paid)?
  let following = false;
  let subscribed = false;
  if (chatIds.length) {
    const [{ data: follow }, { data: sub }] = await Promise.all([
      db
        .from("follows")
        .select("owner_id")
        .in("chat_id", chatIds)
        .eq("owner_id", ownerId)
        .limit(1)
        .maybeSingle(),
      db
        .from("subscriptions")
        .select("status")
        .in("chat_id", chatIds)
        .eq("owner_id", ownerId)
        .in("status", ["trialing", "active", "past_due", "canceling"])
        .limit(1)
        .maybeSingle(),
    ]);
    following = !!follow;
    subscribed = !!sub;
  }
  const chatWithOwner = chats.find((c) => c.owner_id === ownerId);
  // Signed up with this creator but no verified card yet (paid profile):
  // the SUBSCRIBE bar becomes "Add your card" and opens the Stripe sheet.
  let needsCard = false;
  if (chatWithOwner) {
    const access = await guestAccessDestination(chatWithOwner.id, ownerId);
    needsCard = !access.allowed;
  }
  const hasChatWithOwner = !!chatWithOwner && !needsCard;
  // Profile-level like count: owner-set base + real guest likes on posts.
  let realLikes = 0;
  for (const n of stats.likes.values()) realLikes += n;
  const likes = profile.likesBase + realLikes;
  // Displayed post count: owner-set override (Social proof tab) or the real one.
  const postCount = profile.postsBase > 0 ? profile.postsBase : (posts ?? []).length;

  // Creator option: visitors without an account (or without the card a paid
  // profile requires) see the media blurred.
  const blurForVisitor = profile.blurPosts && (chats.length === 0 || needsCard);

  const feedPosts: FeedPost[] = (posts ?? []).map((post) => ({
    id: post.id,
    ownerId,
    ownerName: profile.name,
    ownerAvatar: profile.avatarPath,
    verified: profile.verified,
    url: mediaUrl(post.media_path),
    type: post.media_type as "image" | "video",
    caption: post.caption,
    createdAt: post.created_at,
    likes: (post.like_count ?? 0) + (stats.likes.get(post.id) ?? 0),
    comments: stats.comments.get(post.id) ?? 0,
    liked: stats.likedByMe.has(post.id),
    blurred: blurForVisitor,
  }));

  // Back from a bank (3-D Secure) redirect mid card step: finish activation.
  const finishing = !!(returnSubId || returnPiId) && !!chatWithOwner;

  return (
    // No footer menu until the fan can actually get in: visitors without an
    // account, and signed-up fans who still owe the card step.
    <GuestPage hideHeader hideNav={chats.length === 0 || needsCard}>
        {finishing && (
          <SubscribeReturn
            ownerId={ownerId}
            subscriptionId={returnSubId}
            paymentIntentId={returnPiId}
          />
        )}
        <section className="pb-4">
          {/* OnlyFans structure: banner, avatar left with actions on the right */}
          <CreatorBanner
            name={profile.name}
            avatarPath={profile.avatarPath}
            bannerPath={profile.bannerPath}
            actions={
              hasChatWithOwner ? (
                <MessageCreatorButton
                  ownerId={ownerId}
                  className="px-5 py-2 rounded-full bg-card border border-line2 text-sm font-semibold"
                />
              ) : undefined
            }
          />

          {/* Identity block: everything left-aligned like OnlyFans */}
          <div className="px-4 pt-3 space-y-2.5">
            <div>
              <p className="font-bold text-xl flex items-center gap-1.5">
                {profile.name}
                <IconVerified className="w-5 h-5 text-accent shrink-0" />
                {profile.verified && (
                  <span className="text-xs font-semibold text-accent shrink-0">
                    ID Verified
                  </span>
                )}
              </p>
              <p className="text-sm text-muted flex items-center gap-1">
                <IconHeart className="w-4 h-4 shrink-0" />
                {formatCount(likes)} {likes === 1 ? "Like" : "Likes"}
                {" · "}
                {formatCount(postCount)} {postCount === 1 ? "post" : "posts"}
              </p>
            </div>

            {bio && (
              <p className="text-sm whitespace-pre-wrap break-words">{bio}</p>
            )}
            {profile.showLocation && location && (
              <p className="flex items-center gap-1 text-xs text-muted">
                <IconMapPin className="w-3.5 h-3.5 text-accent shrink-0" />
                {location}
              </p>
            )}

            {/* Full-width subscription bar under the bio, like OnlyFans:
                visitors get SUBSCRIBE (register), signed-up fans get Follow. */}
            {needsCard && invite?.code ? (
              <div className="pt-1">
                <ProfileSubscribeCta
                  code={invite.code}
                  ownerId={ownerId}
                  ownerName={profile.name}
                  plan={profile.plan}
                  cardOnly
                  autoOpen={openCardSheet}
                />
              </div>
            ) : chats.length > 0 ? (
              <div className="pt-1">
                <FollowButton
                  ownerId={ownerId}
                  ownerName={profile.name}
                  initialFollowing={following}
                  plan={profile.plan}
                  initialSubscribed={subscribed}
                  full
                />
              </div>
            ) : invite?.code ? (
              <div className="pt-1">
                <ProfileSubscribeCta
                  code={invite.code}
                  ownerId={ownerId}
                  ownerName={profile.name}
                  plan={profile.plan}
                />
              </div>
            ) : null}
          </div>
        </section>

        <div className="border-t border-line">
          <PostFeed posts={feedPosts} canInteract={chats.length > 0 && !needsCard} />
        </div>
    </GuestPage>
  );
}
