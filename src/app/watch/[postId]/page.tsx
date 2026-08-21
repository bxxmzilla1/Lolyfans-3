import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ownerProfiles } from "@/lib/guest";
import { postStats } from "@/lib/posts";
import { mediaUrl } from "@/lib/utils";
import PostFeed, { type FeedPost } from "@/components/PostFeed";
import WatchNav from "@/components/WatchNav";
import Logo from "@/components/Logo";
import { IconBack } from "@/components/Icons";
import {
  AdsterraBanner300x250,
  AdsterraLeaderboard,
  AdsterraNativeBanner,
  AdsterraScripts,
  AdsterraSideRails,
} from "@/components/AdsterraAds";

export const dynamic = "force-dynamic";

/**
 * Single-video watch page. Scrolling past the end (or the arrow buttons)
 * loads the previous/next video as a FULL page load, so every video shows a
 * fresh set of ad units and counts new impressions.
 */
export default async function WatchPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  const db = supabaseAdmin();

  // All video posts in home-feed order (newest first) to find the neighbors.
  const { data: videos } = await db
    .from("posts")
    .select("id, owner_id")
    .eq("media_type", "video")
    .order("created_at", { ascending: false })
    .limit(300);
  const order = videos ?? [];
  const index = order.findIndex((p) => p.id === postId);
  if (index === -1) redirect("/");

  const { data: post } = await db
    .from("posts")
    .select("*")
    .eq("id", postId)
    .single();
  if (!post) redirect("/");

  const [profiles, stats] = await Promise.all([
    ownerProfiles([post.owner_id as string]),
    postStats([post.id as string], []),
  ]);
  const profile = profiles.get(post.owner_id);
  if (!profile) redirect("/");

  const feedPost: FeedPost = {
    id: post.id,
    ownerId: post.owner_id,
    ownerName: profile.name,
    ownerAvatar: profile.avatarPath,
    verified: profile.verified,
    url: mediaUrl(post.media_path),
    type: post.media_type as "image" | "video",
    caption: post.caption,
    createdAt: post.created_at,
    likes: (post.like_count ?? 0) + (stats.likes.get(post.id) ?? 0),
    comments: stats.comments.get(post.id) ?? 0,
    liked: false,
  };

  const prevHref = index > 0 ? `/watch/${order[index - 1].id}` : null;
  const nextHref =
    index < order.length - 1 ? `/watch/${order[index + 1].id}` : null;

  return (
    <main className="min-h-dvh">
      {/* Adsterra: page-level scripts (invisible units). */}
      <AdsterraScripts />

      <header className="sticky top-0 z-30 border-b border-line bg-card/80 backdrop-blur-lg px-4 py-3">
        <div className="max-w-lg lg:max-w-2xl mx-auto flex items-center gap-2.5">
          <Link href="/" aria-label="Back to the feed" className="shrink-0">
            <IconBack className="w-6 h-6" />
          </Link>
          <Logo className="w-8 h-8 glow-accent" />
          <span className="text-xl font-bold ig-gradient-text tracking-tight">
            LolyFans
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-lg lg:max-w-2xl lg:px-8 pb-10">
        {/* Adsterra: leaderboard (728x90 desktop / 320x50 mobile). */}
        <AdsterraLeaderboard />

        <div className="lg:bg-card lg:border lg:border-line lg:rounded-2xl lg:overflow-hidden">
          <PostFeed posts={[feedPost]} canInteract={false} />
        </div>

        {/* Adsterra: 300x250 rectangle + native banner below the video. */}
        <AdsterraBanner300x250 />
        <AdsterraNativeBanner />

        {/* Adsterra: skyscrapers — fixed side rails on wide screens,
            inline side-by-side pair on mobile. */}
        <AdsterraSideRails />

        {nextHref && (
          <p className="text-center text-xs text-muted pt-3 pb-2">
            Scroll down for the next video
          </p>
        )}
      </div>

      <WatchNav prevHref={prevHref} nextHref={nextHref} />
    </main>
  );
}
