"use client";

import { useEffect, useState } from "react";
import { IconCard } from "./Icons";

/** Dispatched by ChatView's fanstate poll so the header doesn't hit the API too. */
export const FANSTATE_EVENT = "loly-fanstate";

export type FanstateDetail = {
  chatId: string;
  hasCard?: boolean;
};

/**
 * Creator's chat header: card icon left of the fan's name once they've
 * registered a card. Updates from ChatView's shared fanstate poll (no
 * second request loop of its own).
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
    setHasCard(initialHasCard);
  }, [chatId, initialHasCard]);

  useEffect(() => {
    function onFanstate(e: Event) {
      const detail = (e as CustomEvent<FanstateDetail>).detail;
      if (!detail || detail.chatId !== chatId) return;
      if (typeof detail.hasCard === "boolean") setHasCard(detail.hasCard);
    }
    window.addEventListener(FANSTATE_EVENT, onFanstate);
    return () => window.removeEventListener(FANSTATE_EVENT, onFanstate);
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
