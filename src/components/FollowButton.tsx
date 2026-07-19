"use client";

import { useEffect, useState } from "react";
import { useGuestShell } from "./GuestShellContext";
import {
  subCaption,
  subCtaLabel,
  type SubPlan,
} from "@/lib/subscriptionPlan";

/**
 * Subscribe button for a creator profile. Free plans toggle a follow;
 * paid plans (set in Settings → Subscriptions) go through Stripe
 * subscription Checkout, whose card is saved for one-tap payments.
 */
export default function FollowButton({
  ownerId,
  initialFollowing,
  small,
  full,
  plan,
  initialSubscribed,
}: {
  ownerId: string;
  initialFollowing: boolean;
  small?: boolean;
  /** Full-width bar like the OnlyFans subscription button. */
  full?: boolean;
  /** Creator's subscription plan; omitted/price 0 = free follow. */
  plan?: SubPlan | null;
  /** Fan already has an active/trialing paid subscription. */
  initialSubscribed?: boolean;
}) {
  const paid = (plan?.priceCents ?? 0) > 0;
  const [following, setFollowing] = useState(initialFollowing);
  const [subscribed, setSubscribed] = useState(!!initialSubscribed);
  const [busy, setBusy] = useState(false);
  const { refresh } = useGuestShell();

  // Back from subscription Checkout: confirm the session (covers webhook
  // failures), flip to Subscribed, and clean the URL.
  useEffect(() => {
    if (!paid) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!params.get("subscribed") || !sessionId) return;
    window.history.replaceState({}, "", window.location.pathname);
    (async () => {
      const res = await fetch("/api/payments/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).catch(() => null);
      if (res?.ok) {
        setSubscribed(true);
        refresh();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paid]);

  async function toggleFollow() {
    if (busy) return;
    const next = !following;
    setFollowing(next);
    setBusy(true);
    try {
      const res = await fetch("/api/guest/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId, follow: next }),
      });
      if (!res.ok) setFollowing(!next);
      else refresh();
    } catch {
      setFollowing(!next);
    }
    setBusy(false);
  }

  async function subscribePaid() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/payments/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.checkoutUrl) {
        // Keep the button disabled until Stripe navigates away.
        window.location.href = data.checkoutUrl;
        return;
      }
      if (res.ok && (data.alreadySubscribed || data.ok)) {
        setSubscribed(true);
        refresh();
      } else if (res.ok && data.free) {
        await toggleFollow();
      } else {
        alert(data.error || "Could not start subscription");
      }
    } catch {
      alert("Could not start subscription");
    }
    setBusy(false);
  }

  async function cancelPaid() {
    if (busy) return;
    if (
      !confirm(
        "Cancel your subscription? You'll keep access until the end of your current billing period."
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/payments/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId, action: "cancel" }),
      });
      if (res.ok) {
        alert("Your subscription won't renew after this period.");
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Could not cancel subscription");
      }
    } catch {
      alert("Could not cancel subscription");
    }
    setBusy(false);
  }

  const active = paid ? subscribed : following;
  const onClick = paid ? (subscribed ? cancelPaid : subscribePaid) : toggleFollow;
  const rightLabel = paid && plan ? subCtaLabel(plan) : "FREE";
  const caption = paid && plan && !subscribed ? subCaption(plan) : null;

  const button = (
    <button
      onClick={onClick}
      disabled={busy}
      className={`${
        small
          ? "px-3.5 py-1.5 text-xs"
          : full
            ? "w-full px-5 py-3 text-sm"
            : "px-6 py-2.5 text-sm min-w-48"
      } rounded-full font-semibold transition-colors disabled:opacity-60 ${
        active
          ? "bg-card2 border border-line2 text-fg"
          : "bg-accent text-white"
      }`}
    >
      {active ? (
        "Subscribed"
      ) : small ? (
        "SUBSCRIBE"
      ) : (
        <span className="flex items-center justify-between gap-8">
          <span>SUBSCRIBE</span>
          <span>{busy ? "…" : rightLabel}</span>
        </span>
      )}
    </button>
  );

  if (!caption || small) return button;
  return (
    <div className="space-y-1.5">
      {button}
      <p className="text-xs text-muted text-center">{caption}</p>
    </div>
  );
}
