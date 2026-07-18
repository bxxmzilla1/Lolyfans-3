import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats, ownerProfiles } from "@/lib/guest";
import { postStats } from "@/lib/posts";
import { mediaUrl } from "@/lib/utils";
import GuestPage from "@/components/GuestPage";
import FollowButton from "@/components/FollowButton";
import PostFeed, { type FeedPost } from "@/components/PostFeed";
import { IconUser, IconVerified } from "@/components/Icons";

export const dynamic = "force-dynamic";

/** Guest home feed: the latest posts from creators the guest follows. */
export default async function GuestHomePage() {
  const requestHeaders = await headers();
  const chats = await guestChats(requestHeaders);
  if (!chats.length) redirect("/");

  const db = supabaseAdmin();
  const chatIds = chats.map((c) => c.id);

  const { data: followRows } = await db
    .from("follows")
    .select("owner_id")
    .in("chat_id", chatIds);
  const followed = [...new Set((followRows ?? []).map((r) => r.owner_id as string))];

  const [{ data: posts }, profiles] = await Promise.all([
    followed.length
      ? db
          .from("posts")
          .select("*")
          .in("owner_id", followed)
          .order("created_at", { ascending: false })
          .limit(60)
      : Promise.resolve({ data: [] as never[] }),
    ownerProfiles([...followed, ...chats.map((c) => c.owner_id)]),
  ]);

  // Creators the guest chats with but doesn't follow yet — suggested on top.
  const suggestions = [...new Set(chats.map((c) => c.owner_id))].filter(
    (id) => !followed.includes(id)
  );

  const stats = await postStats(
    (posts ?? []).map((p) => p.id),
    chatIds
  );
  const feedPosts: FeedPost[] = (posts ?? []).map((post) => {
    const p = profiles.get(post.owner_id);
    return {
      id: post.id,
      ownerId: post.owner_id,
      ownerName: p?.name || "Lolyfans",
      ownerAvatar: p?.avatarPath || null,
      verified: !!p?.verified,
      url: mediaUrl(post.media_path),
      type: post.media_type as "image" | "video",
      caption: post.caption,
      createdAt: post.created_at,
      likes: (post.like_count ?? 0) + (stats.likes.get(post.id) ?? 0),
      comments: stats.comments.get(post.id) ?? 0,
      liked: stats.likedByMe.has(post.id),
    };
  });

  return (
    <GuestPage title="Home">
        {suggestions.length > 0 && (
          <section className="px-4 pt-4 space-y-2">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">
              Suggested for you
            </p>
            {suggestions.map((id) => {
              const p = profiles.get(id);
              return (
                <div
                  key={id}
                  className="flex items-center gap-3 rounded-2xl border border-line2 bg-card p-3"
                >
                  <Link href={`/p/${id}`} className="flex items-center gap-3 min-w-0 flex-1">
                    {p?.avatarPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mediaUrl(p.avatarPath)}
                        alt={p?.name || ""}
                        className="w-10 h-10 rounded-full object-cover bg-bg shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-card2 flex items-center justify-center shrink-0">
                        <IconUser className="w-5 h-5 text-muted" />
                      </div>
                    )}
                    <span className="font-semibold text-sm truncate flex items-center gap-1">
                      {p?.name}
                      {p?.verified && <IconVerified className="w-4 h-4 text-sky-500 shrink-0" />}
                    </span>
                  </Link>
                  <FollowButton ownerId={id} initialFollowing={false} small />
                </div>
              );
            })}
          </section>
        )}

        {feedPosts.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="font-semibold mb-1">No posts yet</p>
            <p className="text-sm text-muted">
              Follow creators to see their latest photos and videos here.
            </p>
          </div>
        ) : (
          <PostFeed posts={feedPosts} canInteract={chats.length > 0} />
        )}
    </GuestPage>
  );
}
