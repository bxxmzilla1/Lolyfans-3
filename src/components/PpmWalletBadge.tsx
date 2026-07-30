"use client";

import { useEffect, useRef, useState } from "react";
import { IconCard } from "./Icons";

/**
 * Fan wallet badge (top-right of the chat header): the chat's accrued Pay
 * per Message balance, auto-charged to their card every hour. Only the
 * running balance is shown — never a per-message cost. State arrives via
 * "loly-ppm" window events dispatched by ChatView's wallet polling.
 */
export default function PpmWalletBadge() {
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [pop, setPop] = useState(false);
  const prevRef = useRef<number | null>(null);

  useEffect(() => {
    const onPpm = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        enabled?: boolean;
        balanceCents?: number;
      } | null;
      if (!d?.enabled) {
        prevRef.current = null;
        setBalanceCents(null);
        return;
      }
      const next = Math.max(0, d.balanceCents ?? 0);
      if (prevRef.current !== null && prevRef.current !== next) {
        setPop(true);
        setTimeout(() => setPop(false), 500);
      }
      prevRef.current = next;
      setBalanceCents(next);
    };
    window.addEventListener("loly-ppm", onPpm);
    return () => window.removeEventListener("loly-ppm", onPpm);
  }, []);

  if (balanceCents === null) return null;

  return (
    <span
      className="ppm-wallet-in inline-flex items-center gap-1.5 rounded-full bg-card2 border border-line px-3 py-1.5 shadow-sm"
      title="Your balance — charged to your card automatically"
    >
      <IconCard className="w-3.5 h-3.5 text-accent shrink-0" />
      <span className="text-[10px] font-semibold text-muted uppercase tracking-wide">
        Wallet
      </span>
      <span
        className={`text-sm font-bold tabular-nums ${pop ? "ppm-wallet-pop" : ""}`}
      >
        ${(balanceCents / 100).toFixed(2)}
      </span>
    </span>
  );
}
