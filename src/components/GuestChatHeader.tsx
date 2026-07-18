"use client";

import Link from "next/link";
import { mediaUrl } from "@/lib/utils";
import { IconBack, IconMapPin, IconUser } from "./Icons";

/** Guest-side chat header: the owner's profile, always shown as online. */
export default function GuestChatHeader({
  ownerId,
  name,
  avatarPath,
  location,
}: {
  ownerId?: string;
  name: string;
  avatarPath: string | null;
  location?: string | null;
}) {
  return (
    <header className="border-b border-line2 px-4 py-3 flex items-center gap-3 bg-card/60 backdrop-blur-lg">
      <Link
        href="/chats"
        aria-label="Back to chats"
        className="relative z-50 shrink-0 -ml-1 w-8 h-8 rounded-full flex items-center justify-center text-muted active:bg-card2"
      >
        <IconBack className="w-5 h-5" />
      </Link>
      <div className="relative shrink-0">
        <div className="ig-ring">
          {avatarPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl(avatarPath)}
              alt={name}
              className="w-10 h-10 rounded-full object-cover bg-bg"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center">
              <IconUser className="w-5 h-5 text-muted" />
            </div>
          )}
        </div>
        <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-bg bg-green-500" />
      </div>
      <div className="min-w-0">
        <p className="font-bold text-[15px] leading-tight truncate">{name}</p>
        <div className="flex items-center gap-2">
          {/* Mobile keeps just the green dot; the text only shows on desktop */}
          <p className="hidden lg:block text-xs text-green-400">Online Now</p>
          {location && (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted truncate">
              <IconMapPin className="w-3 h-3 text-accent shrink-0" />
              {location}
            </span>
          )}
        </div>
      </div>
      {ownerId && (
        <Link
          href={`/p/${ownerId}`}
          // z-50 keeps it clickable under the invisible owner corner button
          className="relative z-50 ml-auto shrink-0 px-3.5 py-2 rounded-full bg-accent text-white text-xs font-semibold whitespace-nowrap active:opacity-80"
        >
          Visit Profile
        </Link>
      )}
    </header>
  );
}
