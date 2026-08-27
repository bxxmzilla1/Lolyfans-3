import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import {
  inviteUsable,
  countryAllowed,
  ipFromHeaders,
  Invite,
  PROFILE_DESTINATION,
} from "@/lib/invites";
import { recordInviteEvent } from "@/lib/inviteEvents";
import { ownerProfiles } from "@/lib/guest";
import { postStats } from "@/lib/posts";
import { applyUserGeoTokens, visitorGeoParts, visitorLocation } from "@/lib/geo";
import { formatCount, mediaUrl } from "@/lib/utils";
import CreatorBanner from "@/components/CreatorBanner";
import InviteSubscribeCta from "@/components/InviteSubscribeCta";
import { guestAccessDestination } from "@/lib/subscriptionAccess";
import {
  IconChat,
  IconHeart,
  IconMapPin,
  IconUser,
  IconVerified,
} from "@/components/Icons";

export const dynamic = "force-dynamic";

/**
 * Invite link profile preview ("Profile page directly" or step after the
 * landing page). The Join button opens a sign-up sheet over this page — the
 * profile stays visible in the background.
 */
export default async function InviteProfilePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ pay?: string }>;
}) {
  const { code } = await params;
  const { pay } = await searchParams;
  const db = supabaseAdmin();
  const requestHeaders = await headers();

  const guestChatId = await getGuestChatId();
  const visitorIp = ipFromHeaders(requestHeaders);

  const [cookieChat, ipChat, inviteRes] = await Promise.all([
    guestChatId
      ? db
          .from("chats")
          .select("id, owner_id")
          .eq("id", guestChatId)
          .maybeSingle()
      : Promise.resolve(null),
    visitorIp
      ? db
          .from("chats")
          .select("id, owner_id")
          .eq("guest_ip", visitorIp)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve(null),
    db.from("invites").select("*").eq("code", code).single<Invite>(),
  ]);

  // Returning guests with an account go straight to the open profile page.
  let alreadyJoined = false;
  let openPay = pay === "1";
  const existing = cookieChat?.data ?? null;
  if (existing) {
    const dest = await guestAccessDestination(existing.id, existing.owner_id);
    if (dest.allowed) redirect(dest.href);
    alreadyJoined = true;
    openPay = true;
  } else if (ipChat?.data) {
    // Restore the guest cookie, then come back here with ?pay=1 if unpaid.
    redirect(`/api/resume?next=${encodeURIComponent(`/i/${code}/profile`)}`);
  }

  const invite = inviteRes.data;

  const country =
    requestHeaders.get("x-vercel-ip-country")?.toUpperCase() || null;

  // Count this view as a link click (unique per IP; revisits are no-ops).
  // Matters for links that skip the landing page — this is their first stop.
  // The visitor's country is stored with the click so analytics can separate
  // allowed-country clicks from geo-blocked ones. Falls back to a country-less
  // upsert if the column hasn't been migrated yet.
  if (invite && visitorIp) {
    after(async () => {
      const { error } = await db
        .from("invite_visits")
        .upsert(
          { invite_id: invite.id, ip: visitorIp, country },
          { onConflict: "invite_id,ip", ignoreDuplicates: true }
        );
      if (error && /country/i.test(error.message)) {
        await db
          .from("invite_visits")
          .upsert(
            { invite_id: invite.id, ip: visitorIp },
            { onConflict: "invite_id,ip", ignoreDuplicates: true }
          );
      }
      // Full log: every click gets its own timestamped row (the helper
      // skips it when the landing page just logged this same visitor).
      await recordInviteEvent({
        inviteId: invite.id,
        kind: "click",
        ip: visitorIp,
        country,
      });
    });
  }

  const usable = inviteUsable(invite);

  // Invite links are pure redirect links now — anyone landing on this old
  // profile preview follows the link's mandatory destination instead.
  const dest = (invite?.redirect_url || "").trim();
  if (usable.ok && dest === PROFILE_DESTINATION) redirect(`/p/${invite!.owner_id}`);
  if (usable.ok && dest) redirect(dest);

  const allowed = invite ? countryAllowed(invite.allowed_countries, country) : false;
  // Blocked links show their reason on the invite page itself.
  if (!usable.ok || !allowed) redirect(`/i/${code}`);

  const ownerId = invite!.owner_id;
  // Only image posts in the locked preview — they blur nicely and load much
  // faster than videos.
  const [profiles, { data: imagePosts }, { count: postCount }, location, geo] =
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
      visitorLocation(requestHeaders),
      visitorGeoParts(requestHeaders),
    ]);

  const profile = profiles.get(ownerId);
  if (!profile) redirect(`/i/${code}`);
  // CITYUSER / COUNTRYUSER in the bio become this visitor's own location.
  const bio = profile.bio ? applyUserGeoTokens(profile.bio, geo) : null;

  const teasers = imagePosts ?? [];
  const stats = await postStats(teasers.map((p) => p.id), []);

  // Profile-level like count: owner-set base + real guest likes on posts.
  let realLikes = 0;
  for (const n of stats.likes.values()) realLikes += n;
  const likes = profile.likesBase + realLikes;
  // Owner-set override (Social proof tab) wins over the real post count.
  const posts = profile.postsBase > 0 ? profile.postsBase : postCount ?? 0;
  const ctaProps = {
    code,
    ownerId,
    ownerName: profile.name,
    plan: profile.plan,
    alreadyJoined,
  };

  return (
    <div className="min-h-dvh pb-10">
      <main className="mx-auto max-w-lg">
        {/* Profile bio: only the Follow button, no Message */}
        <section className="pb-4">
          <CreatorBanner
            name={profile.name}
            avatarPath={profile.avatarPath}
            bannerPath={profile.bannerPath}
          />
          {/* Identity block: everything left-aligned like OnlyFans */}
          <div className="px-4 pt-3 space-y-2.5">
            <div>
              <p className="font-bold text-xl flex items-center gap-1.5">
                {profile.name}
                {profile.verified && <IconVerified className="w-5 h-5 text-sky-500" />}
              </p>
              <p className="text-sm text-muted flex items-center gap-1">
                <IconHeart className="w-4 h-4 shrink-0" />
                {formatCount(likes)} {likes === 1 ? "Like" : "Likes"}
                {" · "}
                {formatCount(posts)} {posts === 1 ? "post" : "posts"}
              </p>
            </div>

            {bio && (
              <p className="text-sm whitespace-pre-wrap break-words">{bio}</p>
            )}
            {profile.showLocation && location && (
              <p className="flex items-center gap-1 text-xs text-muted">
                <IconMapPin className="w-3.5 h-3.5 text-accent shrink-0" />
                {location}
              </p>
            )}

            {/* Full-width join bar — opens Stripe over this profile page.
                The CTA carries its own caption (trial + price, or "Free to
                join"). */}
            <div className="pt-1 space-y-2">
              <InviteSubscribeCta {...ctaProps} />
            </div>
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
          <p className="text-sm font-semibold">
            Join for free to see more
          </p>
          <InviteSubscribeCta {...ctaProps} />
        </div>
      </main>
    </div>
  );
}
