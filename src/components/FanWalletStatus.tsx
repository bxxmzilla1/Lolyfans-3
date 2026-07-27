"use client";

import { useEffect, useState } from "react";
import { IconCard, IconTip } from "./Icons";

/**
 * Creator's chat header, live: a card icon to the left of the fan's name
 * once they've registered a card, and their token balance to the right.
 * Polls every second (while the tab is visible) so a top-up or card
 * registration shows without a refresh. The fan's name is passed as
 * children so it renders between the two indicators.
 */
export default function FanWalletStatus({
  chatId,
  initialBalance,
  initialHasCard,
  children,
}: {
  chatId: string;
  initialBalance: number;
  initialHasCard: boolean;
  children: React.ReactNode;
}) {
  const [balance, setBalance] = useState(initialBalance);
  const [hasCard, setHasCard] = useState(initialHasCard);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/chats/fanstate?chatId=${chatId}`);
        if (!res.ok) return;
        const data = (await res.json()) as { balance?: number; hasCard?: boolean };
        if (stopped) return;
        if (typeof data.balance === "number") setBalance(data.balance);
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
      {/* Fan's token balance — how much they can spend right now */}
      <span
        className="inline-flex items-center gap-1 rounded-full bg-accent/10 text-accent text-[11px] font-bold px-2 py-0.5 shrink-0"
        title="Fan's token balance"
      >
        <IconTip className="w-3 h-3" />
        {balance.toLocaleString("en-US")}
      </span>
    </>
  );
}
