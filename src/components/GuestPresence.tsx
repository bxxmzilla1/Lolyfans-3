"use client";

import { useEffect } from "react";
import { trackGuestPresence } from "@/lib/guestPresence";

/**
 * Invisible: while the guest has their chat page open, they announce presence
 * on the owner's guest-presence channel so the owner sees them as online, and
 * heartbeat the server so offline SMS nudges are skipped while they're here.
 */
export default function GuestPresence({
  chatId,
  ownerId,
}: {
  chatId: string;
  ownerId: string;
}) {
  useEffect(() => trackGuestPresence(ownerId, chatId), [ownerId, chatId]);

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
