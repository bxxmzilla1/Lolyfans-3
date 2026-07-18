import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats, ownerProfiles } from "@/lib/guest";
import { postStats } from "@/lib/posts";
import { visitorLocation } from "@/lib/geo";
import { formatCount, mediaUrl } from "@/lib/utils";
import GuestPage from "@/components/GuestPage";
import ProfileLockGate from "@/components/ProfileLockGate";
import PostFeed, { type FeedPost } from "@/components/PostFeed";
import CreatorBanner from "@/components/CreatorBanner";
import { IconChat, IconHeart, IconMapPin, IconUser, IconVerified } from "@/components/Icons";

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

  const header = (
    <>
      <CreatorBanner
        name={profile.name}
        avatarPath={profile.avatarPath}
        bannerPath={profile.bannerPath}
      />
      <div className="px-4 pt-3 flex flex-col items-center gap-3">
        <p className="font-bold text-lg flex items-center gap-1">
          {profile.name}
          {profile.verified && <IconVerified className="w-5 h-5 text-sky-500" />}
        </p>
        <p className="text-xs text-muted -mt-2">
          {formatCount(followers)} {followers === 1 ? "subscriber" : "subscribers"}
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
      </div>
    </>
  );

  const messageButton = hasChatWithOwner ? (
    <Link
      href="/chat"
      className="px-6 py-2.5 rounded-full bg-card2 border border-line2 text-sm font-semibold"
    >
      Message
    </Link>
  ) : null;

  /* Locked feed: blurred media, visible captions and counts, nothing
     clickable — same treatment as the invite-link preview. */
  const lockedFeed = (
    <div className="border-t border-line divide-y divide-line pointer-events-none select-none">
            {feedPosts.map((post) => (
              <article key={post.id}>
                <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                  {profile.avatarPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(profile.avatarPath)}
                      alt={profile.name}
                      className="w-9 h-9 rounded-full object-cover bg-bg"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-card2 flex items-center justify-center">
                      <IconUser className="w-4.5 h-4.5 text-muted" />
                    </div>
                  )}
                  <span className="font-semibold text-sm flex items-center gap-1 min-w-0 truncate">
                    {profile.name}
                    {profile.verified && (
                      <IconVerified className="w-4 h-4 text-sky-500 shrink-0" />
                    )}
                  </span>
                </div>

                {post.caption && (
                  <p className="px-3.5 pb-2.5 text-sm whitespace-pre-wrap break-words">
                    {post.caption}
                  </p>
                )}

                <div className="relative overflow-hidden">
                  {post.type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.url}
                      alt=""
                      loading="lazy"
                      className="w-full h-auto max-h-[70vh] object-contain blur-2xl scale-105"
                    />
                  ) : (
                    <video
                      src={post.url}
                      preload="metadata"
                      muted
                      playsInline
                      className="w-full h-auto max-h-[70vh] object-contain blur-2xl scale-105"
                    />
                  )}
                </div>

                <div className="px-3.5 py-2.5 flex items-center gap-4 text-sm font-semibold">
                  <span className="flex items-center gap-1.5">
                    <IconHeart className="w-6 h-6" />
                    {formatCount(post.likes)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <IconChat className="w-6 h-6" />
                    {formatCount(post.comments)}
                  </span>
                </div>
              </article>
            ))}
    </div>
  );

  return (
    <GuestPage hideHeader>
      <ProfileLockGate
        ownerId={ownerId}
        initialFollowing={following}
        canSubscribe={chats.length > 0}
        header={header}
        messageButton={messageButton}
        lockedFeed={lockedFeed}
        unlockedFeed={
          <div className="border-t border-line">
            <PostFeed posts={feedPosts} canInteract={chats.length > 0} />
          </div>
        }
      />
    </GuestPage>
  );
}
