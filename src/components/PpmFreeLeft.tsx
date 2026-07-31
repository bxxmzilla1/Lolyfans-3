"use client";

import { useEffect, useState } from "react";
import { formatPpmMoney } from "@/lib/payPerMessage";

/**
 * Remaining free credit next to a fan's name on the open chat page only.
 * Hidden when Pay per Message is off. Updates from ChatView's fanstate poll.
 */
export default function PpmFreeLeft({
  chatId,
  initialEnabled,
  initialCreditCents,
}: {
  chatId: string;
  initialEnabled: boolean;
  initialCreditCents: number;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [creditCents, setCreditCents] = useState(
    initialEnabled ? initialCreditCents : 0
  );

  useEffect(() => {
    const onFanstate = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        chatId?: string;
        ppmEnabled?: boolean;
        ppmCreditCents?: number;
      } | null;
      if (d?.chatId !== chatId) return;
      if (typeof d.ppmEnabled === "boolean") setEnabled(d.ppmEnabled);
      if (typeof d.ppmCreditCents === "number") {
        setCreditCents(Math.max(0, d.ppmCreditCents));
      }
    };
    window.addEventListener("loly-fanstate", onFanstate);
    return () => window.removeEventListener("loly-fanstate", onFanstate);
  }, [chatId]);

  if (!enabled) return null;

  return (
    <span
      title={`${formatPpmMoney(creditCents)} free credit left`}
      className="shrink-0 text-[11px] font-semibold text-muted tabular-nums"
    >
      {formatPpmMoney(creditCents)} left
    </span>
  );
}
