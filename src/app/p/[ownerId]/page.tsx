import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats, ownerProfiles } from "@/lib/guest";
import { postStats } from "@/lib/posts";
import { visitorLocation } from "@/lib/geo";
import { formatCount, mediaUrl } from "@/lib/utils";
import GuestPage from "@/components/GuestPage";
import FollowButton from "@/components/FollowButton";
import PostFeed, { type FeedPost } from "@/components/PostFeed";
import { IconMapPin, IconUser, IconVerified } from "@/components/Icons";

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

  // Is this guest already following the creator?
  let following = false;
  if (chatIds.length) {
    const { data: follow } = await db
      .from("follows")
      .select("owner_id")
      .in("chat_id", chatIds)
      .eq("owner_id", ownerId)
      .limit(1)
      .maybeSingle();
    following = !!follow;
  }
  const hasChatWithOwner = chats.some((c) => c.owner_id === ownerId);
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
    <GuestPage
      title={
        <>
          {profile.name}
          {profile.verified && <IconVerified className="w-4 h-4 text-sky-500" />}
        </>
      }
    >
        <section className="px-4 pt-6 pb-4 flex flex-col items-center gap-3">
          <div className="relative">
            <div className="ig-ring">
              {profile.avatarPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(profile.avatarPath)}
                  alt={profile.name}
                  className="w-24 h-24 rounded-full object-cover bg-bg"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-card2 flex items-center justify-center">
                  <IconUser className="w-10 h-10 text-muted" />
                </div>
              )}
            </div>
            <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-bg bg-green-500" />
          </div>
          <p className="font-bold text-lg flex items-center gap-1">
            {profile.name}
            {profile.verified && <IconVerified className="w-5 h-5 text-sky-500" />}
          </p>
          <p className="text-xs text-muted -mt-2">
            {formatCount(followers)} {followers === 1 ? "follower" : "followers"}
            {" · "}
            {feedPosts.length} {feedPosts.length === 1 ? "post" : "posts"}
          </p>
          {(profile.bio || (profile.showLocation && location)) && (
            <div className="w-full text-center space-y-1.5">
              {profile.bio && (
                <p className="text-sm whitespace-pre-wrap break-words">{profile.bio}</p>
              )}
              {profile.showLocation && location && (
                <p className="flex items-center justify-center gap-1 text-xs text-muted">
                  <IconMapPin className="w-3.5 h-3.5 text-accent shrink-0" />
                  {location}
                </p>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            {chats.length > 0 && (
              <FollowButton ownerId={ownerId} initialFollowing={following} />
            )}
            {hasChatWithOwner && (
              <Link
                href="/chat"
                className="px-6 py-2.5 rounded-full bg-card2 border border-line2 text-sm font-semibold"
              >
                Message
              </Link>
            )}
          </div>
        </section>

        <div className="border-t border-line">
          <PostFeed posts={feedPosts} canInteract={chats.length > 0} />
        </div>
    </GuestPage>
  );
}
