import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOwnerId, getGuestChatId } from "@/lib/session";
import { ipFromHeaders } from "@/lib/invites";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ownerProfiles } from "@/lib/guest";
import { postStats } from "@/lib/posts";
import { mediaUrl } from "@/lib/utils";
import Logo from "@/components/Logo";
import PostFeed, { type FeedPost } from "@/components/PostFeed";

export const dynamic = "force-dynamic";

/** How many of the newest posts across all creators the public feed shows. */
const FEED_LIMIT = 60;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string }>;
}) {
  if (await getOwnerId()) redirect("/inbox");

  // Only resume the guest chat if the cookie points at a chat that still exists.
  // (A cookie left over from a deleted chat would otherwise ping-pong with /chat.)
  const guestChatId = await getGuestChatId();
  if (guestChatId) {
    const { data: existing } = await supabaseAdmin()
      .from("chats")
      .select("id")
      .eq("id", guestChatId)
      .maybeSingle();
    if (existing) redirect("/chat");
  }

  // Returning guest without a usable cookie (none at all, or one pointing at a
  // deleted chat)? The device is remembered by IP — match it to a previous
  // chat so typing the bare domain always reopens the same conversation.
  const { resume } = await searchParams;
  if (resume !== "0") {
    const ip = ipFromHeaders(await headers());
    if (ip) {
      const { data: chat } = await supabaseAdmin()
        .from("chats")
        .select("id")
        .eq("guest_ip", ip)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (chat) redirect("/api/resume");
    }
  }

  // Everyone else — first-time visitors — get the public home feed: every
  // creator's posts, newest first.
  const { data: posts } = await supabaseAdmin()
    .from("posts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(FEED_LIMIT);

  const rows = posts ?? [];
  const [profiles, stats] = await Promise.all([
    ownerProfiles(rows.map((p) => p.owner_id as string)),
    postStats(
      rows.map((p) => p.id as string),
      []
    ),
  ]);

  const feedPosts: FeedPost[] = rows.map((post) => {
    const profile = profiles.get(post.owner_id);
    return {
      id: post.id,
      ownerId: post.owner_id,
      ownerName: profile?.name || "Lolyfans",
      ownerAvatar: profile?.avatarPath || null,
      verified: !!profile?.verified,
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
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line2 bg-card/80 backdrop-blur-lg">
        <div className="mx-auto max-w-lg lg:max-w-2xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Logo className="w-8 h-8" />
            <p className="text-xl font-bold ig-gradient-text tracking-tight">
              Lolyfans
            </p>
          </div>
          <Link
            href="/login"
            className="shrink-0 px-4 py-1.5 rounded-full bg-accent text-white text-xs font-semibold active:opacity-80 transition-opacity"
          >
            Log in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-lg lg:max-w-2xl lg:px-8 lg:pt-6">
        <div className="lg:bg-card lg:border lg:border-line lg:rounded-2xl lg:overflow-hidden">
          {/* Visitors browse only: liking, commenting and messaging need an
              account, so the feed renders read-only. */}
          <PostFeed posts={feedPosts} canInteract={false} />
        </div>
      </main>

      <footer className="mx-auto max-w-lg lg:max-w-2xl px-4 py-8 text-center">
        <p className="text-xs text-muted">
          Are you a creator?{" "}
          <Link href="/creator" className="text-accent font-semibold">
            Sign in here
          </Link>
        </p>
      </footer>
    </div>
  );
}
