"use client";

import { useEffect, useState } from "react";
import { IconCard, IconTip } from "./Icons";

/** Dispatched by ChatView's fanstate poll so the header doesn't hit the API too. */
export const FANSTATE_EVENT = "loly-fanstate";

export type FanstateDetail = {
  chatId: string;
  balance?: number;
  hasWallet?: boolean;
};

/**
 * Creator's chat header, left of the fan's name: the wallet icon when the
 * fan signed up with Phantom — plus the fan's live token balance on the
 * right of the name.
 */
export default function FanWalletStatus({
  chatId,
  initialBalance = 0,
  initialHasWallet,
  children,
}: {
  chatId: string;
  initialBalance?: number;
  initialHasWallet: boolean;
  children: React.ReactNode;
}) {
  const [balance, setBalance] = useState(initialBalance);
  const [hasWallet, setHasWallet] = useState(initialHasWallet);

  useEffect(() => {
    setBalance(initialBalance);
    setHasWallet(initialHasWallet);
  }, [chatId, initialBalance, initialHasWallet]);

  useEffect(() => {
    function onFanstate(e: Event) {
      const detail = (e as CustomEvent<FanstateDetail>).detail;
      if (!detail || detail.chatId !== chatId) return;
      if (typeof detail.balance === "number") setBalance(detail.balance);
      if (typeof detail.hasWallet === "boolean") setHasWallet(detail.hasWallet);
    }
    window.addEventListener(FANSTATE_EVENT, onFanstate);
    return () => window.removeEventListener(FANSTATE_EVENT, onFanstate);
  }, [chatId]);

  return (
    <>
      {hasWallet ? (
        <span title="Phantom wallet linked" className="shrink-0 text-accent">
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
