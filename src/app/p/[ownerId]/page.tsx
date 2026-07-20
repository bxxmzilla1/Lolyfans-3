import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats, ownerProfiles } from "@/lib/guest";
import { postStats } from "@/lib/posts";
import { visitorLocation } from "@/lib/geo";
import { formatCount, mediaUrl } from "@/lib/utils";
import { guestAccessDestination } from "@/lib/subscriptionAccess";
import GuestPage from "@/components/GuestPage";
import FollowButton from "@/components/FollowButton";
import PostFeed, { type FeedPost } from "@/components/PostFeed";
import CreatorBanner from "@/components/CreatorBanner";
import { IconMapPin, IconVerified } from "@/components/Icons";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A creator's public profile: OnlyFans-style feed with likes and comments. */
export default async function CreatorProfilePage({
  params,
}: {
  params: Promise<{ ownerId: string }>;
}) {
  const { ownerId } = await params;
  if (!UUID_RE.test(ownerId)) notFound();

  const requestHeaders = await headers();
  const db = supabaseAdmin();

  const [profiles, chats, { data: posts }, { count: realFollowers }, location] =
    await Promise.all([
      ownerProfiles([ownerId]),
      guestChats(requestHeaders),
      db
        .from("posts")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(90),
      db
        .from("follows")
        .select("chat_id", { count: "exact", head: true })
        .eq("owner_id", ownerId),
      visitorLocation(requestHeaders),
    ]);

  const profile = profiles.get(ownerId);
  if (!profile) notFound();

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
  // Signed up but unpaid → back to the card step, not the open profile.
  if (chatWithOwner) {
    const access = await guestAccessDestination(chatWithOwner.id, ownerId);
    if (!access.allowed) redirect(access.href);
  }
  const hasChatWithOwner = !!chatWithOwner;
  const followers = profile.followerBase + (realFollowers ?? 0);

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
  }));

  return (
    <GuestPage hideHeader>
        <section className="pb-4">
          {/* OnlyFans structure: banner, avatar left with actions on the right */}
          <CreatorBanner
            name={profile.name}
            avatarPath={profile.avatarPath}
            bannerPath={profile.bannerPath}
            actions={
              hasChatWithOwner ? (
                <Link
                  href="/chat"
                  className="px-5 py-2 rounded-full bg-card border border-line2 text-sm font-semibold"
                >
                  Message
                </Link>
              ) : undefined
            }
          />

          {/* Identity block: everything left-aligned like OnlyFans */}
          <div className="px-4 pt-3 space-y-2.5">
            <div>
              <p className="font-bold text-xl flex items-center gap-1.5">
                {profile.name}
                {profile.verified && <IconVerified className="w-5 h-5 text-sky-500" />}
              </p>
              <p className="text-sm text-muted">
                {formatCount(followers)} {followers === 1 ? "subscriber" : "subscribers"}
                {" · "}
                {feedPosts.length} {feedPosts.length === 1 ? "post" : "posts"}
              </p>
            </div>

            {profile.bio && (
              <p className="text-sm whitespace-pre-wrap break-words">{profile.bio}</p>
            )}
            {profile.showLocation && location && (
              <p className="flex items-center gap-1 text-xs text-muted">
                <IconMapPin className="w-3.5 h-3.5 text-accent shrink-0" />
                {location}
              </p>
            )}

            {/* Full-width subscription bar under the bio, like OnlyFans */}
            {chats.length > 0 && (
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
            )}
          </div>
        </section>

        <div className="border-t border-line">
          <PostFeed posts={feedPosts} canInteract={chats.length > 0} />
        </div>
    </GuestPage>
  );
}
