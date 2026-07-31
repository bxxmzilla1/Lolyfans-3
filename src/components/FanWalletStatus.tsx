"use client";

import { useEffect, useState } from "react";
import { IconCard, IconClock } from "./Icons";

/** Dispatched by ChatView's fanstate poll so the header doesn't hit the API too. */
export const FANSTATE_EVENT = "loly-fanstate";

export type FanstateDetail = {
  chatId: string;
  hasCard?: boolean;
  /** PaidSub offer showing in the fan's chat, not paid yet. */
  paidSubPending?: boolean;
};

/**
 * Creator's chat header, left of the fan's name: an orange clock while a
 * PaidSub offer awaits payment, otherwise the card icon once a card is
 * registered. Updates from ChatView's shared fanstate poll (no second
 * request loop of its own).
 */
export default function FanWalletStatus({
  chatId,
  initialHasCard,
  initialPaidSubPending = false,
  children,
}: {
  chatId: string;
  initialHasCard: boolean;
  initialPaidSubPending?: boolean;
  children: React.ReactNode;
}) {
  const [hasCard, setHasCard] = useState(initialHasCard);
  const [paidSubPending, setPaidSubPending] = useState(initialPaidSubPending);

  useEffect(() => {
    setHasCard(initialHasCard);
    setPaidSubPending(initialPaidSubPending);
  }, [chatId, initialHasCard, initialPaidSubPending]);

  useEffect(() => {
    function onFanstate(e: Event) {
      const detail = (e as CustomEvent<FanstateDetail>).detail;
      if (!detail || detail.chatId !== chatId) return;
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
    </>
  );
}
