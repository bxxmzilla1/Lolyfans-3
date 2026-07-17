"use client";

import { IconUser, IconVerified } from "./Icons";

/** Invite page profile: avatar with an online dot and the inviter's name. */
export default function InviteProfile({
  name,
  avatarUrl,
  verified,
}: {
  name: string;
  avatarUrl: string | null;
  verified?: boolean;
}) {
  return (
    <>
      <div className="relative">
        <div className="ig-ring">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={name}
              className="w-24 h-24 rounded-full object-cover bg-bg"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-bg flex items-center justify-center">
              <IconUser className="w-10 h-10 text-muted" />
            </div>
          )}
        </div>
        <span className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-green-500 border-4 border-bg" />
      </div>

      <div className="text-center -mt-2">
        <h1 className="text-2xl font-bold flex items-center justify-center gap-1.5">
          {name}
          {verified && <IconVerified className="w-5 h-5 text-[#1d9bf0]" />}
        </h1>
      </div>
    </>
  );
}
