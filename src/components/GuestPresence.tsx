"use client";

import { useEffect, useRef } from "react";
import { trackGuestPresence } from "@/lib/guestPresence";
import { markGuestChatReadLocally } from "@/lib/guestBootstrapCache";

/**
 * Invisible: while the guest has their chat page open, they announce presence
 * on the owner's guest-presence channel so the owner sees them as online, and
 * heartbeat the server so offline SMS nudges are skipped while they're here.
 *
 * Also marks the chat as read once the page has loaded, so the list/footer
 * badges clear only after the conversation is actually on screen.
 */
export default function GuestPresence({
  chatId,
  ownerId,
}: {
  chatId: string;
  ownerId: string;
}) {
  const markedRef = useRef<string | null>(null);

  useEffect(() => trackGuestPresence(ownerId, chatId), [ownerId, chatId]);

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

  useEffect(() => {
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/guest/ping", { method: "POST" }).catch(() => {});
    };
    ping();
    const interval = setInterval(ping, 45_000);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [chatId]);

  return null;
}
