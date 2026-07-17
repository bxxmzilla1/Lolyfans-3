"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { mediaUrl } from "@/lib/utils";
import { IconUser } from "./Icons";

/** Guest-side chat header: the owner's profile picture, name and live online status. */
export default function GuestChatHeader({
  ownerId,
  name,
  avatarPath,
}: {
  ownerId: string;
  name: string;
  avatarPath: string | null;
}) {
  const [online, setOnline] = useState(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase.channel(`presence:owner:${ownerId}`);
    channel
      .on("presence", { event: "sync" }, () => {
        setOnline(Object.keys(channel.presenceState()).length > 0);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ownerId]);

  return (
    <header className="border-b border-line px-4 py-3 flex items-center gap-3 bg-card/60 backdrop-blur-lg">
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
        <span
          className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-bg transition-colors ${
            online ? "bg-green-500" : "bg-zinc-500"
          }`}
        />
      </div>
      <div className="min-w-0">
        <p className="font-bold text-[15px] leading-tight truncate">{name}</p>
        <p className={`text-xs ${online ? "text-green-400" : "text-muted"}`}>
          {online ? "Online" : "Offline"}
        </p>
      </div>
    </header>
  );
}
