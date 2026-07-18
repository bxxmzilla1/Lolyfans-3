"use client";

import { useEffect, useState } from "react";
import { trackGuestPresence } from "@/lib/guestPresence";
import type { ChatOwnerPair } from "@/lib/useInboxSignals";

/**
 * Invisible, mounted with the guest nav on every guest page: announces the
 * fan as online to every creator they chat with while they're ANYWHERE in the
 * app (Home, Chats, Profile, creator pages, the chat itself) — not just with
 * the conversation open. Also heartbeats guest_last_seen_at (seen-only, no
 * read-marking) so offline SMS nudges are skipped while they're browsing.
 */
export default function GuestAppPresence() {
  const [pairs, setPairs] = useState<ChatOwnerPair[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/guest/chats")
      .then((r) => (r.ok ? r.json() : { chats: [] }))
      .then((json) => {
        if (alive) setPairs(json.chats ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // One presence channel per creator (dedupe: a guest has one chat per owner).
  const presenceKey = [
    ...new Map(pairs.map((p) => [p.ownerId, p.chatId])).entries(),
  ]
    .map(([ownerId, chatId]) => `${ownerId}:${chatId}`)
    .sort()
    .join(",");

  useEffect(() => {
    if (!presenceKey) return;
    const stops = presenceKey.split(",").map((entry) => {
      const [ownerId, chatId] = entry.split(":");
      return trackGuestPresence(ownerId, chatId);
    });
    return () => stops.forEach((stop) => stop());
  }, [presenceKey]);

  // Seen-only heartbeat: keeps guest_last_seen_at fresh across all their
  // chats without touching the read cursor (badges stay accurate).
  const hasChats = pairs.length > 0;
  useEffect(() => {
    if (!hasChats) return;
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/guest/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seenOnly: true }),
      }).catch(() => {});
    };
    ping();
    const interval = setInterval(ping, 45_000);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [hasChats]);

  return null;
}
