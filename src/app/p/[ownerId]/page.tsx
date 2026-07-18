import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats, ownerProfiles } from "@/lib/guest";
import { mediaUrl } from "@/lib/utils";
import GuestFooter from "@/components/GuestFooter";
import FollowButton from "@/components/FollowButton";
import PostGrid, { type GridPost } from "@/components/PostGrid";
import { IconUser, IconVerified } from "@/components/Icons";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A creator's public profile: picture, name, follow button and post grid. */
export default async function CreatorProfilePage({
  params,
}: {
  params: Promise<{ ownerId: string }>;
}) {
  const { ownerId } = await params;
  if (!UUID_RE.test(ownerId)) notFound();

  const requestHeaders = await headers();
  const db = supabaseAdmin();

  const [profiles, chats, { data: posts }] = await Promise.all([
    ownerProfiles([ownerId]),
    guestChats(requestHeaders),
    db
      .from("posts")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(90),
  ]);

  const profile = profiles.get(ownerId);
  if (!profile) notFound();

  // Is this guest already following the creator?
  let following = false;
  if (chats.length) {
    const { data: follow } = await db
      .from("follows")
      .select("owner_id")
      .in("chat_id", chats.map((c) => c.id))
      .eq("owner_id", ownerId)
      .limit(1)
      .maybeSingle();
    following = !!follow;
  }
  const hasChatWithOwner = chats.some((c) => c.owner_id === ownerId);

  const gridPosts: GridPost[] = (posts ?? []).map((post) => ({
    id: post.id,
    url: mediaUrl(post.media_path),
    type: post.media_type as "image" | "video",
    caption: post.caption,
  }));

  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-30 border-b border-line2 bg-card/80 backdrop-blur-lg px-4 py-3">
        <h1 className="max-w-lg mx-auto font-bold text-lg flex items-center gap-1 justify-center">
          {profile.name}
          {profile.verified && <IconVerified className="w-4 h-4 text-sky-500" />}
        </h1>
      </header>

      <main className="max-w-lg mx-auto">
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
            {gridPosts.length} {gridPosts.length === 1 ? "post" : "posts"}
          </p>
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
          <PostGrid posts={gridPosts} />
        </div>
      </main>

      <GuestFooter />
    </div>
  );
}
