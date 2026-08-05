"use client";

import { useEffect, useRef } from "react";

/**
 * Guest-side Chat-per-minute metering. Mounted only on CPM chats:
 *  - Soft heartbeat every 60s (keeps last_active fresh).
 *  - Hard settle every 30 minutes (charges unpaid minutes).
 *  - On tab close / navigate away, settle remaining minutes via sendBeacon.
 *
 * Session start itself lives in /api/messages (first send after a return).
 */
export default function CpmMeter({ chatId }: { chatId: string }) {
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  useEffect(() => {
    const heartbeat = setInterval(() => {
      void fetch("/api/cpm/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {});
    }, 60_000);

    const settle = setInterval(() => {
      void fetch("/api/cpm/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settle: true }),
      }).catch(() => {});
    }, 30 * 60_000);

    const onLeave = () => {
      navigator.sendBeacon(
        "/api/cpm/end",
        new Blob([JSON.stringify({ chatId: chatIdRef.current })], {
          type: "application/json",
        })
      );
    };
    window.addEventListener("pagehide", onLeave);

    return () => {
      clearInterval(heartbeat);
      clearInterval(settle);
      window.removeEventListener("pagehide", onLeave);
      // Soft navigate away from /chat — settle remaining minutes. (Tab
      // close is already handled by pagehide / sendBeacon above.)
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
