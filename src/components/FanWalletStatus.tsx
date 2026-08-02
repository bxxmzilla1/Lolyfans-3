"use client";

import { IconCard } from "./Icons";

/**
 * Owner inbox chip: whether the fan has a card on file for one-tap dollar
 * charges. Token balances are gone — only the card badge remains.
 */
export default function FanWalletStatus({
  initialHasCard = false,
  children,
}: {
  chatId?: string;
  initialBalance?: number;
  initialHasCard?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <>
      {initialHasCard && (
        <span title="Card on file" className="text-muted shrink-0">
          <IconCard className="w-3.5 h-3.5" />
        </span>
      )}
      {children}
    </>
  );
}
