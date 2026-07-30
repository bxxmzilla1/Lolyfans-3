"use client";

import { useEffect, useState } from "react";

/**
 * "N left" next to a fan's name — how many free Pay per Message sends they
 * still have. Updates from ChatView's fanstate poll (loly-fanstate).
 */
export default function PpmFreeLeft({
  chatId,
  initialEnabled,
  initialFree,
  initialUsed,
}: {
  chatId: string;
  initialEnabled: boolean;
  initialFree: number;
  initialUsed: number;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [free, setFree] = useState(initialFree);
  const [used, setUsed] = useState(initialUsed);

  useEffect(() => {
    const onFanstate = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        chatId?: string;
        ppmEnabled?: boolean;
        ppmFreeMessages?: number;
        ppmMessagesUsed?: number;
      } | null;
      if (d?.chatId !== chatId) return;
      if (typeof d.ppmEnabled === "boolean") setEnabled(d.ppmEnabled);
      if (typeof d.ppmFreeMessages === "number") setFree(d.ppmFreeMessages);
      if (typeof d.ppmMessagesUsed === "number") setUsed(d.ppmMessagesUsed);
    };
    window.addEventListener("loly-fanstate", onFanstate);
    return () => window.removeEventListener("loly-fanstate", onFanstate);
  }, [chatId]);

  if (!enabled) return null;
  const left = Math.max(0, free - used);

  return (
    <span
      title={`${left} free messages left`}
      className="shrink-0 text-[11px] font-semibold text-muted tabular-nums"
    >
      {left} left
    </span>
  );
}
