"use client";

import { useEffect, useRef } from "react";

/**
 * Guest-side Chat-per-minute metering. Mounted only on CPM chats:
 *  - Soft heartbeat every 20s (keeps last_active fresh so the creator sees
 *    Active + earnings — no charge on these ticks).
 *  - Hard settle every 10 minutes (charges accrued minutes in one lump).
 *  - On tab close / navigate away, settle remaining minutes via sendBeacon.
 *
 * Session start itself lives in /chat page load (returning fans).
 */
export default function CpmMeter({ chatId }: { chatId: string }) {
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  useEffect(() => {
    const tick = () => {
      void fetch("/api/cpm/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {});
    };
    // Immediate heartbeat so the creator's "Active" badge flips on right away.
    tick();
    const heartbeat = setInterval(tick, 20_000);

    // One lump charge every 10 minutes — never per-minute (bank card blocks).
    const settle = setInterval(() => {
      void fetch("/api/cpm/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settle: true }),
      }).catch(() => {});
    }, 10 * 60_000);

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
