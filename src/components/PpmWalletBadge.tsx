"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Fan "Balance" button (top-right of the chat header). Tapping it pops the
 * accrued Pay per Message amount in the same animated bubble that used to
 * show the token wallet — pops in, holds, then hides on its own. State
 * arrives via "loly-ppm" window events from ChatView's wallet polling.
 */
export default function PpmWalletBadge() {
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [showBubble, setShowBubble] = useState(false);
  const [bubbleKey, setBubbleKey] = useState(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onPpm = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        enabled?: boolean;
        balanceCents?: number;
      } | null;
      if (!d?.enabled) {
        setBalanceCents(null);
        setShowBubble(false);
        return;
      }
      setBalanceCents(Math.max(0, d.balanceCents ?? 0));
    };
    window.addEventListener("loly-ppm", onPpm);
    return () => {
      window.removeEventListener("loly-ppm", onPpm);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (balanceCents === null) return null;

  function reveal() {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    // Bump the key so the CSS animation restarts even on a re-tap.
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
            ${(balanceCents / 100).toFixed(2)}
          </span>
        </span>
      )}
    </div>
  );
}
