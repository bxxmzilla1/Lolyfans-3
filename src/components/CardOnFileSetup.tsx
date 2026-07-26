"use client";

import { useEffect, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { getStripe, stripeAppearance } from "@/lib/stripeClient";

/**
 * Mandatory card-on-file step for FREE signups. Confirms a SetupIntent —
 * nothing is charged — so the saved card powers one-tap top-ups later.
 * Card fields only: Link and wallets are disabled so the fan types their
 * details in place, once.
 */

function SetupForm({
  ownerId,
  buttonText,
  onSuccess,
}: {
  ownerId: string;
  buttonText: string;
  onSuccess: () => void;
}) {
  const stripeJs = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!stripeJs || !elements || saving) return;
    setSaving(true);
    setError("");
    const result = await stripeJs.confirmSetup({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: `${window.location.origin}/chat` },
    });
    if (result.error) {
      setError(result.error.message || "Could not save your card. Please try again.");
      setSaving(false);
      return;
    }

    const res = await fetch("/api/payments/card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId, setupIntentId: result.setupIntent?.id }),
    }).catch(() => null);
    if (res?.ok) {
      onSuccess();
    } else {
      const data = await res?.json().catch(() => ({}));
      setError(data?.error || "Could not save your card. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <PaymentElement
        onReady={() => setReady(true)}
        options={{ wallets: { link: "never" } }}
      />
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button
        onClick={save}
        disabled={!ready || saving}
        className="w-full bg-accent text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {saving ? (
          <span className="inline-flex items-center gap-2">
            <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            Saving…
          </span>
        ) : (
          buttonText
        )}
      </button>
      <p className="text-[11px] text-muted text-center">
        Your card details are securely stored by Stripe — we never see them.
      </p>
    </div>
  );
}

export default function CardOnFileSetup({
  ownerId,
  buttonText = "Save card & start chatting",
  onSuccess,
}: {
  ownerId: string;
  buttonText?: string;
  onSuccess: () => void;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/payments/card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerId }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.clientSecret) {
          setClientSecret(data.clientSecret);
        } else if (res.ok && data.saved) {
          // Returning fan — card already on file, nothing to do.
          onSuccess();
        } else {
          setError(data.error || "Could not load the card form");
        }
      } catch {
        if (!cancelled) setError("Could not load the card form");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-card2 border border-line px-3.5 py-3 space-y-1">
        <p className="text-sm font-semibold">Add a card to finish signing up</p>
        <p className="text-xs text-muted">
          <span className="font-semibold text-fg">No charges will be applied</span>{" "}
          — signing up is free. Your card is only used to verify your account.
        </p>
      </div>

      {error ? (
        <p className="text-red-400 text-sm">{error}</p>
      ) : !clientSecret ? (
        <div className="py-10 flex items-center justify-center">
          <span className="w-6 h-6 rounded-full border-2 border-line border-t-accent animate-spin" />
        </div>
      ) : (
        <Elements
          stripe={getStripe()}
          options={{ clientSecret, appearance: stripeAppearance() }}
        >
          <SetupForm ownerId={ownerId} buttonText={buttonText} onSuccess={onSuccess} />
        </Elements>
      )}
    </div>
  );
}
