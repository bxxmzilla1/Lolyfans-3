"use client";

import { useEffect, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { getStripe, stripeAppearance } from "@/lib/stripeClient";
import {
  subCaption,
  subCtaLabel,
  subDollars,
  subFirstPeriodCents,
  subPriceLabel,
  type SubPlan,
} from "@/lib/subscriptionPlan";

type Intent = {
  mode: "payment" | "setup";
  clientSecret: string;
  subscriptionId?: string;
  paymentIntentId?: string;
};

function payButtonLabel(plan: SubPlan): string {
  if (plan.interval === "lifetime") return `Pay ${subDollars(plan.priceCents)} once`;
  if (plan.trialDays > 0)
    return `Start ${plan.trialDays}-day free trial`;
  if (plan.discountPct > 0)
    return `Subscribe · ${subDollars(subFirstPeriodCents(plan))} today`;
  return `Subscribe · ${subPriceLabel(plan)}`;
}

function PayForm({
  ownerId,
  plan,
  intent,
  onSuccess,
}: {
  ownerId: string;
  plan: SubPlan;
  intent: Intent;
  onSuccess: () => void;
}) {
  const stripeJs = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");

  async function pay() {
    if (!stripeJs || !elements || paying) return;
    setPaying(true);
    setError("");
    // 3-D Secure shows in a modal over the page; card payments never redirect,
    // but return_url covers the rare bank that forces one.
    const returnUrl =
      `${window.location.origin}/p/${ownerId}?subscribed=1` +
      (intent.subscriptionId ? `&sub=${intent.subscriptionId}` : "") +
      (intent.paymentIntentId ? `&pi=${intent.paymentIntentId}` : "");
    const result =
      intent.mode === "setup"
        ? await stripeJs.confirmSetup({
            elements,
            redirect: "if_required",
            confirmParams: { return_url: returnUrl },
          })
        : await stripeJs.confirmPayment({
            elements,
            redirect: "if_required",
            confirmParams: { return_url: returnUrl },
          });

    if (result.error) {
      setError(result.error.message || "Payment failed. Please try again.");
      setPaying(false);
      return;
    }

    const res = await fetch("/api/payments/subscribe/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerId,
        subscriptionId: intent.subscriptionId,
        paymentIntentId: intent.paymentIntentId,
      }),
    }).catch(() => null);
    if (res?.ok) {
      onSuccess();
    } else {
      const data = await res?.json().catch(() => ({}));
      setError(data?.error || "Payment went through but activation failed — refresh the page.");
      setPaying(false);
    }
  }

  return (
    <div className="space-y-4">
      <PaymentElement onReady={() => setReady(true)} />
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button
        onClick={pay}
        disabled={!ready || paying}
        className="w-full bg-accent text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {paying ? (
          <span className="inline-flex items-center gap-2">
            <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            Processing…
          </span>
        ) : (
          payButtonLabel(plan)
        )}
      </button>
      <p className="text-[11px] text-muted text-center">
        {plan.interval === "lifetime"
          ? "One-time payment · lifetime access · card saved for one-tap unlocks"
          : "Cancel anytime · card saved for one-tap unlocks"}
      </p>
    </div>
  );
}

/**
 * In-page subscribe form (Stripe Payment Element). The whole flow stays on
 * the site: amount summary, themed card fields, pay button.
 */
export default function SubscribeCheckout({
  ownerId,
  ownerName,
  plan,
  onSuccess,
}: {
  ownerId: string;
  ownerName?: string;
  plan: SubPlan;
  onSuccess: () => void;
}) {
  const [intent, setIntent] = useState<Intent | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/payments/subscribe/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerId }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.clientSecret) {
          setIntent(data as Intent);
        } else if (res.ok && (data.alreadySubscribed || data.free)) {
          onSuccess();
        } else {
          setError(data.error || "Could not start payment");
        }
      } catch {
        if (!cancelled) setError("Could not start payment");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-card2 border border-line px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">
            {ownerName ? `Subscribe to ${ownerName}` : "Subscription"}
          </p>
          {subCaption(plan) && (
            <p className="text-xs text-muted">{subCaption(plan)}</p>
          )}
        </div>
        <p className="text-sm font-bold text-accent shrink-0">{subCtaLabel(plan)}</p>
      </div>

      {error ? (
        <p className="text-red-400 text-sm">{error}</p>
      ) : !intent ? (
        <div className="py-10 flex items-center justify-center">
          <span className="w-6 h-6 rounded-full border-2 border-line border-t-accent animate-spin" />
        </div>
      ) : (
        <Elements
          stripe={getStripe()}
          options={{
            clientSecret: intent.clientSecret,
            appearance: stripeAppearance(),
          }}
        >
          <PayForm ownerId={ownerId} plan={plan} intent={intent} onSuccess={onSuccess} />
        </Elements>
      )}
    </div>
  );
}
