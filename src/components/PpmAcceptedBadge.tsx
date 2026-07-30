"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { IconShieldCheck } from "./Icons";

/**
 * Purple shield next to the fan's name once they've accepted the Pay per
 * Message agreement. Flips live: instantly via the chat's realtime channel
 * (the accept endpoint broadcasts "ppm-accepted"), with the fanstate poll
 * as backup.
 */
export default function PpmAcceptedBadge({
  chatId,
  initialAccepted,
}: {
  chatId: string;
  initialAccepted: boolean;
}) {
  const [accepted, setAccepted] = useState(initialAccepted);

  useEffect(() => {
    const onFanstate = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        chatId?: string;
        ppmAccepted?: boolean;
      } | null;
      if (d?.chatId === chatId && d.ppmAccepted === true) setAccepted(true);
    };
    window.addEventListener("loly-fanstate", onFanstate);

    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`chat:${chatId}`)
      .on("broadcast", { event: "ppm-accepted" }, () => setAccepted(true));
    channel.subscribe();

    return () => {
      window.removeEventListener("loly-fanstate", onFanstate);
      supabase.removeChannel(channel);
    };
  }, [chatId]);

  if (!accepted) return null;

  return (
    <span
      title="Accepted the pay-per-message agreement"
      className="shrink-0 text-purple-500"
    >
      <IconShieldCheck className="w-4 h-4" />
    </span>
  );
}
