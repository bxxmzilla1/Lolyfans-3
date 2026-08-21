import { redirect } from "next/navigation";
import Link from "next/link";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ownerProfiles } from "@/lib/guest";
import { postStats } from "@/lib/posts";
import { mediaUrl } from "@/lib/utils";
import PostFeed, { type FeedPost } from "@/components/PostFeed";
import Logo from "@/components/Logo";
import {
  AdsterraBanner300x250,
  AdsterraBanner468,
  AdsterraLeaderboard,
  AdsterraNativeBanner,
  AdsterraScripts,
  AdsterraSideRails,
} from "@/components/AdsterraAds";

export const dynamic = "force-dynamic";

/**
 * Public homepage: the Home Feed. Anyone landing on lolyfans.com sees the
 * latest posts from every creator (no account needed), with Adsterra ads.
 * Creators still land on their dashboard.
 */
export default async function Home() {
  if (await getOwnerId()) redirect("/inbox");

  const db = supabaseAdmin();
  const { data: posts } = await db
    .from("posts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(90);

  const ownerIds = [...new Set((posts ?? []).map((p) => p.owner_id as string))];
  const [profiles, stats] = await Promise.all([
    ownerProfiles(ownerIds),
    postStats(
      (posts ?? []).map((p) => p.id as string),
      []
    ),
  ]);

  const feedPosts: FeedPost[] = (posts ?? [])
    .filter((post) => profiles.has(post.owner_id))
    .map((post) => {
      const profile = profiles.get(post.owner_id)!;
      return {
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
    });

  return (
    <main className="min-h-dvh">
      {/* Adsterra: page-level scripts (invisible units). */}
      <AdsterraScripts />

      <header className="sticky top-0 z-30 border-b border-line bg-card/80 backdrop-blur-lg px-4 py-3">
        <div className="max-w-lg lg:max-w-2xl mx-auto flex items-center gap-2.5">
          <Logo className="w-8 h-8 glow-accent" />
          <span className="text-xl font-bold ig-gradient-text tracking-tight">
            LolyFans
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-lg lg:max-w-2xl lg:px-8 pb-10">
        {/* Adsterra: leaderboard (728x90 desktop / 320x50 mobile) and the
            468x60 banner above the feed. */}
        <AdsterraLeaderboard />
        <AdsterraBanner468 />

        <div className="lg:bg-card lg:border lg:border-line lg:rounded-2xl lg:overflow-hidden">
          <PostFeed posts={feedPosts} canInteract={false} watchOnTap />
        </div>

        {/* Adsterra: 300x250 rectangle + native banner below the feed. */}
        <AdsterraBanner300x250 />
        <AdsterraNativeBanner />

        {/* Adsterra: skyscrapers — fixed side rails on wide screens,
            inline side-by-side pair on mobile. */}
        <AdsterraSideRails />

        <p className="text-center text-xs text-muted pt-4">
          Are you a creator?{" "}
          <Link href="/creator" className="text-accent font-semibold">
            Sign in here
          </Link>
        </p>
      </div>
    </main>
  );
}
