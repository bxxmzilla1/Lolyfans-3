import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { inviteUsable, countryAllowed, ipFromHeaders, Invite } from "@/lib/invites";
import { ownerProfiles } from "@/lib/guest";
import { formatCount, mediaUrl } from "@/lib/utils";
import { IconUser, IconVerified } from "@/components/Icons";

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
  const usable = inviteUsable(invite);
  const country =
    requestHeaders.get("x-vercel-ip-country")?.toUpperCase() || null;
  const allowed = invite ? countryAllowed(invite.allowed_countries, country) : false;
  // Blocked links show their reason on the invite page itself.
  if (!usable.ok || !allowed) redirect(`/i/${code}`);

  const ownerId = invite!.owner_id;
  const [profiles, { data: latestPost }, { count: postCount }, { count: realFollowers }] =
    await Promise.all([
      ownerProfiles([ownerId]),
      db
        .from("posts")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId),
      db
        .from("follows")
        .select("chat_id", { count: "exact", head: true })
        .eq("owner_id", ownerId),
    ]);

  const profile = profiles.get(ownerId);
  if (!profile) redirect(`/i/${code}`);

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
            {formatCount(posts)} {posts === 1 ? "post" : "posts"}
          </p>
          <Link
            href={`/i/${code}/signup`}
            className="px-10 py-2.5 rounded-full bg-accent text-white text-sm font-semibold active:opacity-80 transition-opacity"
          >
            Follow
          </Link>
        </section>

        {/* One locked post as a teaser */}
        {latestPost && (
          <div className="border-t border-line">
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

            <div className="relative overflow-hidden">
              {latestPost.media_type === "video" ? (
                <video
                  src={`${mediaUrl(latestPost.media_path)}#t=0.001`}
                  muted
                  playsInline
                  preload="metadata"
                  tabIndex={-1}
                  className="w-full h-auto max-h-[70vh] object-contain blur-2xl scale-105 pointer-events-none select-none"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(latestPost.media_path)}
                  alt=""
                  className="w-full h-auto max-h-[70vh] object-contain blur-2xl scale-105 pointer-events-none select-none"
                />
              )}
            </div>

            <div className="px-4 py-5 text-center space-y-3">
              <p className="text-sm font-semibold">Follow this creator to see more</p>
              <Link
                href={`/i/${code}/signup`}
                className="inline-block px-10 py-2.5 rounded-full bg-accent text-white text-sm font-semibold active:opacity-80 transition-opacity"
              >
                Follow
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
