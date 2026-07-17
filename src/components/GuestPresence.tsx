"use client";

import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Invisible: while the guest has their chat page open, their presence is
 * tracked on a per-chat realtime channel so the owner can see them as online.
 */
export default function GuestPresence({ chatId }: { chatId: string }) {
  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase.channel(`presence:chat:${chatId}`, {
      config: { presence: { key: "guest" } },
    });
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ online_at: new Date().toISOString() });
      }
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId]);

  return null;
}
