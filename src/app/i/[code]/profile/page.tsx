import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { inviteUsable, countryAllowed, ipFromHeaders, Invite } from "@/lib/invites";
import { ownerProfiles } from "@/lib/guest";
import { postStats } from "@/lib/posts";
import { visitorLocation } from "@/lib/geo";
import { formatCount, mediaUrl } from "@/lib/utils";
import CreatorBanner from "@/components/CreatorBanner";
import {
  IconChat,
  IconHeart,
  IconMapPin,
  IconUser,
  IconVerified,
} from "@/components/Icons";

export const dynamic = "force-dynamic";

/**
 * Step 2 of an invite link: a locked preview of the creator's profile.
 * One blurred post, no footer menu, no Message buttons — just a Follow
 * button that leads to sign-up.
 */
export default async function InviteProfilePreviewPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const db = supabaseAdmin();
  const requestHeaders = await headers();

  const guestChatId = await getGuestChatId();
  const visitorIp = ipFromHeaders(requestHeaders);

  const [cookieChat, ipChat, inviteRes] = await Promise.all([
    // Already signed up? Straight back into the full experience.
    guestChatId
      ? db.from("chats").select("id").eq("id", guestChatId).maybeSingle()
      : Promise.resolve(null),
    visitorIp
      ? db
          .from("chats")
          .select("id")
          .eq("guest_ip", visitorIp)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve(null),
    db.from("invites").select("*").eq("code", code).single<Invite>(),
  ]);
  if (cookieChat?.data) redirect("/chat");
  if (ipChat?.data) redirect("/api/resume");

  const invite = inviteRes.data;

  // Count this view as a link click (unique per IP; revisits are no-ops).
  // Matters for links that skip the landing page — this is their first stop.
  if (invite && visitorIp) {
    after(async () => {
      await db
        .from("invite_visits")
        .upsert(
          { invite_id: invite.id, ip: visitorIp },
          { onConflict: "invite_id,ip", ignoreDuplicates: true }
        );
    });
  }

  const usable = inviteUsable(invite);
  const country =
    requestHeaders.get("x-vercel-ip-country")?.toUpperCase() || null;
  const allowed = invite ? countryAllowed(invite.allowed_countries, country) : false;
  // Blocked links show their reason on the invite page itself.
  if (!usable.ok || !allowed) redirect(`/i/${code}`);

  const ownerId = invite!.owner_id;
  // Only image posts in the locked preview — they blur nicely and load much
  // faster than videos.
  const [profiles, { data: imagePosts }, { count: postCount }, { count: realFollowers }, location] =
    await Promise.all([
      ownerProfiles([ownerId]),
      db
        .from("posts")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("media_type", "image")
        .order("created_at", { ascending: false })
        .limit(30),
      db
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId),
      db
        .from("follows")
        .select("chat_id", { count: "exact", head: true })
        .eq("owner_id", ownerId),
      visitorLocation(requestHeaders),
    ]);

  const profile = profiles.get(ownerId);
  if (!profile) redirect(`/i/${code}`);

  const teasers = imagePosts ?? [];
  const stats = await postStats(teasers.map((p) => p.id), []);

  const followers = profile.followerBase + (realFollowers ?? 0);
  const posts = postCount ?? 0;

  return (
    <div className="min-h-dvh pb-10">
      <header className="sticky top-0 z-30 border-b border-line2 bg-card/80 backdrop-blur-lg px-4 py-3">
        <h1 className="max-w-lg mx-auto font-bold text-lg flex items-center gap-1 justify-center">
          {profile.name}
          {profile.verified && <IconVerified className="w-4 h-4 text-sky-500" />}
        </h1>
      </header>

      <main className="mx-auto max-w-lg">
        {/* Profile bio: only the Follow button, no Message */}
        <section className="pb-4">
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
              {formatCount(posts)} {posts === 1 ? "post" : "posts"}
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
            <Link
              href={`/i/${code}/signup`}
              className="w-full py-3.5 px-6 rounded-full bg-accent text-white text-base font-semibold flex items-center justify-between active:opacity-80 transition-opacity"
            >
              <span>Subscribe</span>
              <span>Free</span>
            </Link>
            <p className="text-xs text-muted -mt-1">
              You must subscribe to this profile to send a message
            </p>
          </div>
        </section>

        {/* All image posts as locked teasers: blurred media, visible caption
            and counts, nothing clickable */}
        {teasers.length > 0 && (
          <div className="border-t border-line divide-y divide-line pointer-events-none select-none">
            {teasers.map((post) => (
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mediaUrl(post.media_path)}
                    alt=""
                    loading="lazy"
                    className="w-full h-auto max-h-[70vh] object-contain blur-2xl scale-105"
                  />
                </div>

                <div className="px-3.5 py-2.5 flex items-center gap-4 text-sm font-semibold">
                  <span className="flex items-center gap-1.5">
                    <IconHeart className="w-6 h-6" />
                    {formatCount((post.like_count ?? 0) + (stats.likes.get(post.id) ?? 0))}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <IconChat className="w-6 h-6" />
                    {formatCount(stats.comments.get(post.id) ?? 0)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}

        {/* Subscribe gate under the locked feed */}
        <div className="border-t border-line px-4 py-6 text-center space-y-3">
          <p className="text-sm font-semibold">Subscribe to this creator to see more</p>
          <Link
            href={`/i/${code}/signup`}
            className="w-full py-3.5 px-6 rounded-full bg-accent text-white text-base font-semibold flex items-center justify-between active:opacity-80 transition-opacity"
          >
            <span>Subscribe</span>
            <span>Free</span>
          </Link>
        </div>
      </main>
    </div>
  );
}
