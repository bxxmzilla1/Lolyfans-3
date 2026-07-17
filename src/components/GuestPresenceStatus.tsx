"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Owner-side live status for the guest of a chat: subscribes to the guest's
 * per-chat presence channel and shows "Online now" while they have their chat
 * page open, "Offline" otherwise.
 */
export default function GuestPresenceStatus({ chatId }: { chatId: string }) {
  const [online, setOnline] = useState(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase.channel(`presence:chat:${chatId}`, {
      config: { presence: { key: "owner-watch" } },
    });

    const refresh = () => {
      const state = channel.presenceState<{ online_at: string }>();
      setOnline(Boolean(state.guest?.length));
    };

    channel
      .on("presence", { event: "sync" }, refresh)
      .on("presence", { event: "join" }, refresh)
      .on("presence", { event: "leave" }, refresh)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId]);

  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <span
        className={`w-2 h-2 rounded-full ${
          online ? "bg-green-500" : "bg-muted/50"
        }`}
      />
      <span className={online ? "text-green-400" : "text-muted"}>
        {online ? "Online now" : "Offline"}
      </span>
    </span>
  );
}
