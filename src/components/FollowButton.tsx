"use client";

import { useEffect, useState } from "react";
import { useGuestShell } from "./GuestShellContext";
import Portal from "./Portal";
import SubscribeCheckout from "./SubscribeCheckout";
import { elementsEnabled } from "@/lib/stripeClient";
import { subCaption, type SubPlan } from "@/lib/subscriptionPlan";

/**
 * Subscribe button for a creator profile. Free plans toggle a follow;
 * paid plans (set in Settings → Subscriptions) go through Stripe
 * subscription Checkout, whose card is saved for one-tap payments.
 */
export default function FollowButton({
  ownerId,
  ownerName,
  initialFollowing,
  small,
  full,
  plan,
  initialSubscribed,
}: {
  ownerId: string;
  ownerName?: string;
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
  const [paySheet, setPaySheet] = useState(false);
  // Private Telegram channel link — fetched from the subscription-gated
  // endpoint, so it only ever exists client-side for paying fans.
  const [tgLink, setTgLink] = useState<string | null>(null);
  const { refresh } = useGuestShell();

  async function fetchTelegramLink(): Promise<string | null> {
    try {
      const res = await fetch(`/api/payments/subscribe/link?ownerId=${ownerId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.link === "string" && data.link) {
        setTgLink(data.link);
        return data.link as string;
      }
    } catch {}
    return null;
  }

  /** After paying: straight into the private Telegram channel. */
  async function openTelegram(): Promise<boolean> {
    const link = tgLink || (await fetchTelegramLink());
    if (!link) return false;
    window.location.href = link;
    return true;
  }

  // Subscribed fans get the channel link ready so the button opens it
  // instantly.
  useEffect(() => {
    if (paid && subscribed) void fetchTelegramLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paid, subscribed]);

  // Back from a payment: either a hosted Checkout session (?session_id=) or a
  // rare 3-D Secure redirect from the in-page form (?sub= / ?pi=). Confirm,
  // flip to Subscribed, and clean the URL.
  useEffect(() => {
    if (!paid) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get("subscribed")) return;
    const sessionId = params.get("session_id");
    const subId = params.get("sub");
    const piId = params.get("pi");
    if (!sessionId && !subId && !piId) return;
    window.history.replaceState({}, "", window.location.pathname);
    (async () => {
      const res = sessionId
        ? await fetch("/api/payments/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
          }).catch(() => null)
        : await fetch("/api/payments/subscribe/activate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ownerId,
              subscriptionId: subId || undefined,
              paymentIntentId: piId || undefined,
            }),
          }).catch(() => null);
      if (res?.ok) {
        setSubscribed(true);
        refresh();
        // Payment confirmed → send them into the private Telegram channel.
        void openTelegram();
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
    // In-page payment form when the publishable key is configured; falls
    // back to Stripe-hosted Checkout otherwise.
    if (elementsEnabled()) {
      setPaySheet(true);
      return;
    }
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
    if (plan?.interval === "lifetime") {
      alert("You have lifetime access — there's nothing to cancel.");
      return;
    }
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

  // Subscribed with a channel link → the button opens Telegram; cancel moves
  // to the small text link underneath.
  async function openOrCancel() {
    if (busy) return;
    if (await openTelegram()) return;
    await cancelPaid();
  }

  const active = paid ? subscribed : following;
  const onClick = paid ? (subscribed ? openOrCancel : subscribePaid) : toggleFollow;
  // Price stays off the button; the caption underneath carries trial + price.
  const caption = paid && plan && !subscribed ? subCaption(plan) : null;
  const joinLabel = paid ? "JOIN PRIVATE TELEGRAM CHANNEL" : "SUBSCRIBE";
  const subscribedLabel = paid && tgLink ? "OPEN TELEGRAM CHANNEL" : "Subscribed";

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
      {active
        ? subscribedLabel
        : small
          ? paid
            ? "JOIN"
            : "SUBSCRIBE"
          : busy
            ? "…"
            : joinLabel}
    </button>
  );

  const sheet = paySheet && plan && (
    <Portal>
      <div
        className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center p-4"
        onClick={() => setPaySheet(false)}
      >
        <div
          className="bg-card border border-line rounded-2xl p-5 w-full max-w-sm fade-up max-h-[90dvh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="font-bold">Join Private Telegram Channel</p>
            <button
              onClick={() => setPaySheet(false)}
              className="text-muted text-sm px-1"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <SubscribeCheckout
            ownerId={ownerId}
            ownerName={ownerName}
            plan={plan}
            onSuccess={() => {
              setPaySheet(false);
              setSubscribed(true);
              refresh();
              // Paid → straight into the private Telegram channel.
              void openTelegram();
            }}
          />
        </div>
      </div>
    </Portal>
  );

  // The main button opens Telegram once subscribed, so cancel becomes a
  // small text link underneath.
  const cancelLink = paid &&
    subscribed &&
    !!tgLink &&
    !small &&
    plan?.interval !== "lifetime" && (
      <button
        onClick={cancelPaid}
        disabled={busy}
        className="w-full text-center text-xs text-muted hover:text-fg transition-colors disabled:opacity-50"
      >
        Cancel subscription
      </button>
    );

  if (!caption && !cancelLink) {
    return (
      <>
        {button}
        {sheet}
      </>
    );
  }
  if (small)
    return (
      <>
        {button}
        {sheet}
      </>
    );
  return (
    <div className="space-y-1.5">
      {button}
      {caption && <p className="text-xs text-muted text-center">{caption}</p>}
      {cancelLink}
      {sheet}
    </div>
  );
}
