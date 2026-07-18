"use client";

import { useEffect, useRef } from "react";
import { markGuestChatReadLocally } from "@/lib/guestBootstrapCache";

/**
 * Invisible, mounted on the chat page: marks the chat as read once the page
 * has loaded, so the list/footer badges clear only after the conversation is
 * actually on screen. (Online presence + the seen heartbeat live in
 * GuestAppPresence, which runs on every guest page.)
 */
export default function GuestPresence({ chatId }: { chatId: string; ownerId?: string }) {
  const markedRef = useRef<string | null>(null);

  // Chat page has loaded → clear this chat's unread in Supabase + local cache.
  useEffect(() => {
    if (markedRef.current === chatId) return;
    markedRef.current = chatId;
    fetch("/api/guest/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
    })
      .then((res) => {
        if (res.ok) markGuestChatReadLocally(chatId);
      })
      .catch(() => {
        markedRef.current = null;
      });
  }, [chatId]);

  return null;
}
