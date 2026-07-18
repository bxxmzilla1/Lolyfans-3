import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats, ownerProfiles } from "@/lib/guest";
import { mediaUrl, formatTime } from "@/lib/utils";
import GuestFooter from "@/components/GuestFooter";
import FollowButton from "@/components/FollowButton";
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

  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-30 border-b border-line2 bg-card/80 backdrop-blur-lg px-4 py-3">
        <h1 className="max-w-lg mx-auto font-bold text-lg">Home</h1>
      </header>

      <main className="max-w-lg mx-auto">
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

        {(posts ?? []).length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="font-semibold mb-1">No posts yet</p>
            <p className="text-sm text-muted">
              Follow creators to see their latest photos and videos here.
            </p>
          </div>
        ) : (
          <div className="py-4 space-y-4">
            {(posts ?? []).map((post) => {
              const p = profiles.get(post.owner_id);
              return (
                <article
                  key={post.id}
                  className="mx-4 rounded-2xl border border-line2 bg-card overflow-hidden"
                >
                  <Link
                    href={`/p/${post.owner_id}`}
                    className="flex items-center gap-2.5 px-3.5 py-2.5"
                  >
                    {p?.avatarPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mediaUrl(p.avatarPath)}
                        alt={p?.name || ""}
                        className="w-8 h-8 rounded-full object-cover bg-bg"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-card2 flex items-center justify-center">
                        <IconUser className="w-4 h-4 text-muted" />
                      </div>
                    )}
                    <span className="font-semibold text-sm flex items-center gap-1 min-w-0 truncate">
                      {p?.name}
                      {p?.verified && <IconVerified className="w-4 h-4 text-sky-500 shrink-0" />}
                    </span>
                    <span className="ml-auto text-[11px] text-muted shrink-0">
                      {formatTime(post.created_at)}
                    </span>
                  </Link>
                  {post.media_type === "video" ? (
                    <video
                      src={mediaUrl(post.media_path)}
                      controls
                      playsInline
                      preload="metadata"
                      className="w-full max-h-[70vh] bg-black"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(post.media_path)}
                      alt={post.caption || "Post"}
                      className="w-full max-h-[70vh] object-cover bg-card2"
                    />
                  )}
                  {post.caption && (
                    <p className="px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words">
                      {post.caption}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>

      <GuestFooter />
    </div>
  );
}
