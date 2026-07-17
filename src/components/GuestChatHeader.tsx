"use client";

import { mediaUrl } from "@/lib/utils";
import { IconMapPin, IconUser } from "./Icons";
import GuestThemeToggle from "./GuestThemeToggle";

/** Guest-side chat header: the owner's profile, always shown as online. */
export default function GuestChatHeader({
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
          <p className="text-xs text-green-400">Online Now</p>
          {location && (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted truncate">
              <IconMapPin className="w-3 h-3 text-accent shrink-0" />
              {location}
            </span>
          )}
        </div>
      </div>
      <GuestThemeToggle />
    </header>
  );
}
