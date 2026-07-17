"use client";

import { useEffect, useState } from "react";
import { IconUser } from "./Icons";

/**
 * Invite page profile: shows "Online X minutes ago" first, then flips to
 * "Online Now" (with the green dot) a few seconds after the page loads.
 */
export default function InviteProfile({
  name,
  avatarUrl,
  minutesAgo,
}: {
  name: string;
  avatarUrl: string | null;
  minutesAgo: number;
}) {
  const [onlineNow, setOnlineNow] = useState(false);

  useEffect(() => {
    const delay = 3000 + Math.random() * 2000; // 3-5s
    const t = setTimeout(() => setOnlineNow(true), delay);
    return () => clearTimeout(t);
  }, []);

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
        {onlineNow && (
          <span className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-green-500 border-4 border-bg fade-up" />
        )}
      </div>

      <div className="text-center -mt-2">
        <h1 className="text-2xl font-bold">{name}</h1>
        <p className="text-green-400 text-xs font-medium mt-1">
          {onlineNow ? "Online Now" : `Online ${minutesAgo} minutes ago`}
        </p>
      </div>
    </>
  );
}
