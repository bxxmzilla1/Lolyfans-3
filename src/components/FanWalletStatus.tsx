"use client";

import { useEffect, useState } from "react";
import { IconCard, IconTip } from "./Icons";

/** Dispatched by ChatView's fanstate poll so the header doesn't hit the API too. */
export const FANSTATE_EVENT = "loly-fanstate";

export type FanstateDetail = {
  chatId: string;
  balance?: number;
  hasCard?: boolean;
};

/**
 * Creator's chat header, left of the fan's name: the card icon once a card
 * is registered — plus the fan's live token balance on the right of the name.
 */
export default function FanWalletStatus({
  chatId,
  initialBalance = 0,
  initialHasCard,
  children,
}: {
  chatId: string;
  initialBalance?: number;
  initialHasCard: boolean;
  children: React.ReactNode;
}) {
  const [balance, setBalance] = useState(initialBalance);
  const [hasCard, setHasCard] = useState(initialHasCard);

  useEffect(() => {
    setBalance(initialBalance);
    setHasCard(initialHasCard);
  }, [chatId, initialBalance, initialHasCard]);

  useEffect(() => {
    function onFanstate(e: Event) {
      const detail = (e as CustomEvent<FanstateDetail>).detail;
      if (!detail || detail.chatId !== chatId) return;
      if (typeof detail.balance === "number") setBalance(detail.balance);
      if (typeof detail.hasCard === "boolean") setHasCard(detail.hasCard);
    }
    window.addEventListener(FANSTATE_EVENT, onFanstate);
    return () => window.removeEventListener(FANSTATE_EVENT, onFanstate);
  }, [chatId]);

  return (
    <>
      {hasCard ? (
        <span title="Card registered" className="shrink-0 text-accent">
          <IconCard className="w-4 h-4" />
        </span>
      ) : null}
      {children}
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
