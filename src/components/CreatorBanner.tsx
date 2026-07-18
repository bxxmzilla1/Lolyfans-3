import { mediaUrl } from "@/lib/utils";
import { IconUser } from "./Icons";

/**
 * Profile banner with the avatar overlapping the bottom edge — same layout
 * language as modern creator profiles (full-bleed cover, white-ringed photo).
 */
export default function CreatorBanner({
  name,
  avatarPath,
  bannerPath,
}: {
  name: string;
  avatarPath: string | null;
  bannerPath: string | null;
}) {
  return (
    <div className="relative">
      <div className="relative w-full h-40 sm:h-48 overflow-hidden bg-card2">
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
        {/* Soft top shade so any overlaid chrome stays readable */}
        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/25 to-transparent pointer-events-none" />
      </div>

      {/* Avatar sits half on the banner, half on the page — white ring like the reference */}
      <div className="flex justify-center -mt-12 relative z-10">
        <div className="relative">
          <div className="rounded-full p-[3px] bg-bg shadow-sm">
            {avatarPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl(avatarPath)}
                alt={name}
                className="w-24 h-24 rounded-full object-cover bg-card2"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-card2 flex items-center justify-center">
                <IconUser className="w-10 h-10 text-muted" />
              </div>
            )}
          </div>
          <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-bg bg-green-500" />
        </div>
      </div>
    </div>
  );
}
