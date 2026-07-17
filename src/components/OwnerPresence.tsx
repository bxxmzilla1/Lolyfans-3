"use client";

import { useEffect } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Invisible: while the owner has the app open, their presence is tracked on
 * a realtime channel so guests can see an "Online" status.
 */
export default function OwnerPresence() {
  useEffect(() => {
    const supabase = supabaseBrowser();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      channel = supabase.channel(`presence:owner:${uid}`, {
        config: { presence: { key: "owner" } },
      });
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel?.track({ online_at: new Date().toISOString() });
        }
      });
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return null;
}
