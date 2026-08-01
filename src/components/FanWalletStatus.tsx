"use client";

import { useEffect, useState } from "react";
import { IconCard, IconClock, IconTip } from "./Icons";

/** Dispatched by ChatView's fanstate poll so the header doesn't hit the API too. */
export const FANSTATE_EVENT = "loly-fanstate";

export type FanstateDetail = {
  chatId: string;
  balance?: number;
  hasCard?: boolean;
  /** PaidSub offer showing in the fan's chat, not paid yet. */
  paidSubPending?: boolean;
};

/**
 * Creator's chat header, left of the fan's name: orange clock while a
 * PaidSub offer awaits payment, otherwise the card icon once a card is
 * registered — plus the fan's live token balance on the right of the name.
 */
export default function FanWalletStatus({
  chatId,
  initialBalance = 0,
  initialHasCard,
  initialPaidSubPending = false,
  children,
}: {
  chatId: string;
  initialBalance?: number;
  initialHasCard: boolean;
  initialPaidSubPending?: boolean;
  children: React.ReactNode;
}) {
  const [balance, setBalance] = useState(initialBalance);
  const [hasCard, setHasCard] = useState(initialHasCard);
  const [paidSubPending, setPaidSubPending] = useState(initialPaidSubPending);

  useEffect(() => {
    setBalance(initialBalance);
    setHasCard(initialHasCard);
    setPaidSubPending(initialPaidSubPending);
  }, [chatId, initialBalance, initialHasCard, initialPaidSubPending]);

  useEffect(() => {
    function onFanstate(e: Event) {
      const detail = (e as CustomEvent<FanstateDetail>).detail;
      if (!detail || detail.chatId !== chatId) return;
      if (typeof detail.balance === "number") setBalance(detail.balance);
      if (typeof detail.hasCard === "boolean") setHasCard(detail.hasCard);
      if (typeof detail.paidSubPending === "boolean") {
        setPaidSubPending(detail.paidSubPending);
      }
    }
    window.addEventListener(FANSTATE_EVENT, onFanstate);
    return () => window.removeEventListener(FANSTATE_EVENT, onFanstate);
  }, [chatId]);

  return (
    <>
      {paidSubPending ? (
        <span title="PaidSub offer pending" className="shrink-0 text-orange-400">
          <IconClock className="w-4 h-4" />
        </span>
      ) : hasCard ? (
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
