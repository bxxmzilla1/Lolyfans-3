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
 *
 * Presence is tied to actual visibility: the moment the fan switches to
 * another app/tab, minimizes the browser, or the page is hidden/frozen, we
 * leave the presence channels so the creator sees them go offline right away.
 * Coming back re-announces them instantly.
 */
export default function GuestAppPresence() {
  const [pairs, setPairs] = useState<ChatOwnerPair[]>([]);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    // `pagehide`/`freeze` fire on mobile when the PWA is backgrounded or the
    // page is about to be suspended — treat both as "left the app".
    const hide = () => setVisible(false);
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pagehide", hide);
    window.addEventListener("focus", update);
    document.addEventListener("freeze", hide);
    document.addEventListener("resume", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("focus", update);
      document.removeEventListener("freeze", hide);
      document.removeEventListener("resume", update);
    };
  }, []);

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

  // Announce only while the app is actually on screen. Leaving (hidden,
  // backgrounded, frozen) tears the channels down → creator sees offline.
  useEffect(() => {
    if (!presenceKey || !visible) return;
    const stops = presenceKey.split(",").map((entry) => {
      const [ownerId, chatId] = entry.split(":");
      return trackGuestPresence(ownerId, chatId);
    });
    return () => stops.forEach((stop) => stop());
  }, [presenceKey, visible]);

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
