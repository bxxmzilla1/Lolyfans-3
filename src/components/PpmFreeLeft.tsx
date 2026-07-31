"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { formatPpmMoney } from "@/lib/payPerMessage";

/**
 * Remaining free money next to a fan's name on the open chat page.
 * Hidden when Pay per Message is off. Updates from the fanstate poll and
 * live "ppm-balance" broadcasts whenever the fan spends credit.
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

    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`chat:${chatId}:ppm-credit`)
      .on("broadcast", { event: "ppm-balance" }, ({ payload }) => {
        const p = payload as { creditCents?: number } | null;
        if (typeof p?.creditCents === "number") {
          setCreditCents(Math.max(0, p.creditCents));
        }
      });
    channel.subscribe();

    return () => {
      window.removeEventListener("loly-fanstate", onFanstate);
      supabase.removeChannel(channel);
    };
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
