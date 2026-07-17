"use client";

import { IconUser } from "./Icons";

/** Invite page profile: always shown as online with the green dot. */
export default function InviteProfile({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
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
        <h1 className="text-2xl font-bold">{name}</h1>
        <p className="text-green-400 text-xs font-medium mt-1">Online</p>
      </div>
    </>
  );
}
