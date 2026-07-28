"use client";

import { useEffect, useState } from "react";
import { IconCard } from "./Icons";

/**
 * Creator's chat header, live: a card icon to the left of the fan's name
 * once they've registered a card. Polls every second (while the tab is
 * visible) so a card registration shows without a refresh. The fan's name
 * is passed as children so it renders next to the indicator.
 */
export default function FanWalletStatus({
  chatId,
  initialHasCard,
  children,
}: {
  chatId: string;
  initialHasCard: boolean;
  children: React.ReactNode;
}) {
  const [hasCard, setHasCard] = useState(initialHasCard);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/chats/fanstate?chatId=${chatId}`);
        if (!res.ok) return;
        const data = (await res.json()) as { hasCard?: boolean };
        if (stopped) return;
        if (typeof data.hasCard === "boolean") setHasCard(data.hasCard);
      } catch {
        // offline blip — next tick retries
      }
    }
    const timer = setInterval(tick, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [chatId]);

  return (
    <>
      {hasCard && (
        <span title="Card registered" className="shrink-0 text-accent">
          <IconCard className="w-4 h-4" />
        </span>
      )}
      {children}
    </>
  );
}
