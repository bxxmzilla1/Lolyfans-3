"use client";

import { useEffect, useState } from "react";
import { subscribeGuestPresence } from "@/lib/guestPresence";

/**
 * Owner-side live status for the guest of a chat: "Online now" while they have
 * their chat page open, "Offline" otherwise.
 */
export default function GuestPresenceStatus({
  chatId,
  ownerId,
}: {
  chatId: string;
  ownerId: string;
}) {
  const [online, setOnline] = useState(false);

  useEffect(
    () => subscribeGuestPresence(ownerId, (ids) => setOnline(ids.has(chatId))),
    [ownerId, chatId]
  );

  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <span className={`w-2 h-2 rounded-full ${online ? "bg-green-500" : "bg-muted/50"}`} />
      <span className={online ? "text-green-400" : "text-muted"}>
        {online ? "Online now" : "Offline"}
      </span>
    </span>
  );
}
