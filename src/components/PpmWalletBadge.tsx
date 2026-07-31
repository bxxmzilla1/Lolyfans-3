"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Fan "Balance" button (top-right of the chat header). Tapping it pops the
 * amount in the same animated bubble as the old token wallet. While free
 * credit remains, that is shown; after it runs out, the owed balance (auto-
 * charged hourly) is shown instead.
 */
export default function PpmWalletBadge() {
  const [displayCents, setDisplayCents] = useState<number | null>(null);
  const [showBubble, setShowBubble] = useState(false);
  const [bubbleKey, setBubbleKey] = useState(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onPpm = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        enabled?: boolean;
        creditCents?: number;
        balanceCents?: number;
      } | null;
      if (!d?.enabled) {
        setDisplayCents(null);
        setShowBubble(false);
        return;
      }
      const credit = Math.max(0, d.creditCents ?? 0);
      const owed = Math.max(0, d.balanceCents ?? 0);
      // Free credit first (money they can still use); then owed amount.
      setDisplayCents(credit > 0 ? credit : owed);
    };
    window.addEventListener("loly-ppm", onPpm);
    return () => {
      window.removeEventListener("loly-ppm", onPpm);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (displayCents === null) return null;

  function reveal() {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setBubbleKey((k) => k + 1);
    setShowBubble(true);
    hideTimerRef.current = setTimeout(() => setShowBubble(false), 2800);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={reveal}
        className="rounded-full bg-card2 border border-line px-3.5 py-1.5 text-xs font-semibold text-fg hover:border-accent active:opacity-80 transition-colors"
      >
        Balance
      </button>
      {showBubble && (
        <span
          key={bubbleKey}
          className="wallet-bubble pointer-events-none absolute right-0 top-full mt-1.5 z-50 inline-flex items-center gap-1.5 rounded-full bg-card border border-line px-3 py-1.5 shadow-lg whitespace-nowrap"
        >
          <span className="text-[10px] font-semibold text-muted uppercase tracking-wide">
            Balance
          </span>
          <span className="text-sm font-bold tabular-nums">
            ${(displayCents / 100).toFixed(2)}
          </span>
        </span>
      )}
    </div>
  );
}
