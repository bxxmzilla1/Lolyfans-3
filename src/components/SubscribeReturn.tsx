"use client";

import { useEffect, useRef } from "react";
import Portal from "./Portal";

/**
 * Landing after a bank redirect (3-D Secure) during the subscription card
 * step: finishes activation with the ids Stripe appended to the return URL,
 * then opens the chat. On failure, reopens the card sheet.
 */
export default function SubscribeReturn({
  ownerId,
  subscriptionId,
  paymentIntentId,
}: {
  ownerId: string;
  subscriptionId?: string;
  paymentIntentId?: string;
}) {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const res = await fetch("/api/payments/subscribe/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId, subscriptionId, paymentIntentId }),
      }).catch(() => null);
      if (res?.ok) {
        window.location.replace("/chat");
      } else {
        window.location.replace(`/p/${ownerId}?subscribe=1`);
      }
    })();
  }, [ownerId, subscriptionId, paymentIntentId]);

  return (
    <Portal>
      <div className="fixed inset-0 z-[80] bg-bg/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
        <span className="w-7 h-7 rounded-full border-2 border-line border-t-accent animate-spin" />
        <p className="text-sm text-muted">Finishing up…</p>
      </div>
    </Portal>
  );
}
