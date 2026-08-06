"use client";

import { useEffect, useRef } from "react";

/**
 * Guest-side Chat-per-minute metering. Mounted only on CPM chats:
 *  - Soft heartbeat every 20s while the tab is visible (keeps Active fresh).
 *  - Hard settle every hour (charges accrued minutes in one lump).
 *  - The moment the tab is hidden / closed → settle + end the session so
 *    they show Idle and are not charged again until they send a message or
 *    interact with media (metering is restarted server-side on those actions).
 *
 * Opening /chat alone does NOT start a session.
 */
export default function CpmMeter({ chatId }: { chatId: string }) {
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/cpm/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {});
    };

    const settleEnd = () => {
      navigator.sendBeacon(
        "/api/cpm/end",
        new Blob([JSON.stringify({ chatId: chatIdRef.current })], {
          type: "application/json",
        })
      );
    };

    // Immediate heartbeat only if they're already in a live session.
    tick();
    const heartbeat = setInterval(tick, 20_000);

    // One lump charge every hour while still visible.
    const settle = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/cpm/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settle: true }),
      }).catch(() => {});
    }, 60 * 60_000);

    // Tab hidden / app backgrounded / close → charge what's owed and stop.
    const onHidden = () => {
      if (document.visibilityState === "hidden") settleEnd();
    };
    const onLeave = () => settleEnd();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onLeave);

    return () => {
      clearInterval(heartbeat);
      clearInterval(settle);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onLeave);
      void fetch("/api/cpm/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: chatIdRef.current }),
        keepalive: true,
      }).catch(() => {});
    };
  }, [chatId]);

  return null;
}
