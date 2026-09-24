import Link from "next/link";
import { mediaUrl } from "@/lib/utils";
import type { CreatorCardData } from "@/lib/creatorDirectory";
import MessageCreatorButton from "./MessageCreatorButton";
import { IconUser, IconVerified } from "./Icons";

const BUTTON_CLASS =
  "block w-full text-center px-5 py-2.5 rounded-full bg-accent text-white text-sm font-semibold active:opacity-80 transition-opacity disabled:opacity-60";

/**
 * Bubble card for a creator: banner on top, avatar overlapping it, name and
 * a Message button. Fans with an account jump straight into their chat with
 * the creator; visitors are sent to the creator's chat sign-up screen.
 */
export default function CreatorCard({
  creator,
  href,
}: {
  creator: CreatorCardData;
  /** Visitor mode: where the Message button links (no account yet). */
  href?: string;
}) {
  const { ownerId, name, avatarPath, bannerPath, verified, bio } = creator;
  return (
    <article className="rounded-3xl border border-line2 bg-card overflow-hidden shadow-sm">
      <div className="relative h-28 bg-card2">
        {bannerPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl(bannerPath)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(145deg, color-mix(in oklab, var(--accent) 22%, var(--card2)) 0%, var(--card2) 55%, color-mix(in oklab, var(--line) 80%, var(--card2)) 100%)",
            }}
          />
        )}
      </div>

      {/* relative + z-10 so the avatar paints over the banner, not under it */}
      <div className="relative z-10 px-4 pb-4 -mt-10 flex flex-col items-center text-center">
        <div className="rounded-full p-[3px] bg-card shadow-sm">
          {avatarPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl(avatarPath)}
              alt={name}
              className="w-20 h-20 rounded-full object-cover bg-card2"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-card2 flex items-center justify-center">
              <IconUser className="w-8 h-8 text-muted" />
            </div>
          )}
        </div>

        <p className="mt-2 font-bold text-base flex items-center gap-1 max-w-full">
          <span className="truncate">{name}</span>
          {verified && <IconVerified className="w-4 h-4 text-sky-500 shrink-0" />}
        </p>
        {bio && (
          <p className="mt-0.5 text-xs text-muted line-clamp-2 break-words max-w-full">
            {bio}
          </p>
        )}

        <div className="mt-3 w-full">
          {href ? (
            <Link href={href} className={BUTTON_CLASS}>
              Message
            </Link>
          ) : (
            <MessageCreatorButton ownerId={ownerId} className={BUTTON_CLASS} />
          )}
        </div>
      </div>
    </article>
  );
}

/** Responsive grid of creator cards with an empty state. */
export function CreatorGrid({
  creators,
  hrefFor,
}: {
  creators: CreatorCardData[];
  hrefFor?: (ownerId: string) => string;
}) {
  if (creators.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="font-semibold mb-1">No creators yet</p>
        <p className="text-sm text-muted">Check back soon.</p>
      </div>
    );
  }
  return (
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
      {creators.map((c) => (
        <CreatorCard
          key={c.ownerId}
          creator={c}
          href={hrefFor ? hrefFor(c.ownerId) : undefined}
        />
      ))}
    </div>
  );
}
