"use client";

import { useEffect, useState } from "react";
import Portal from "./Portal";
import EmbeddedCardTopup from "./EmbeddedCardTopup";
import { elementsEnabled } from "@/lib/stripeClient";
import { subCaption, type SubPlan } from "@/lib/subscriptionPlan";
import { IconEye, IconEyeOff } from "./Icons";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Intent = {
  mode: "payment" | "setup";
  clientSecret: string;
  subscriptionId?: string;
  paymentIntentId?: string;
};

/**
 * Invite-profile "Join Private Telegram Channel" button. Keeps the profile
 * page visible behind a blur and runs sign-up + the same 3-step Stripe card
 * wizard used in chat — no navigation away to /signup.
 */
export default function InviteSubscribeCta({
  code,
  ownerId,
  plan,
  /** Returning unpaid guest — open the card sheet immediately. */
  initialOpen = false,
  /** Already has a guest session for this creator (skip the sign-up form). */
  alreadyJoined = false,
}: {
  code: string;
  ownerId: string;
  /** Kept for callers; the sheet no longer shows the creator's name. */
  ownerName?: string;
  plan: SubPlan;
  initialOpen?: boolean;
  alreadyJoined?: boolean;
}) {
  const paid = plan.priceCents > 0;
  // Both free and paid profiles gate the private Telegram channel now.
  const joinLabel = "JOIN PRIVATE TELEGRAM CHANNEL";
  // The price never rides on the button — the caption below carries the
  // trial + daily price (paid) or "Free to join" (free).
  const caption = paid ? subCaption(plan) : "Free to join";

  const [open, setOpen] = useState(initialOpen && paid);
  const [step, setStep] = useState<"signup" | "card">(
    alreadyJoined && paid ? "card" : "signup"
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [intentError, setIntentError] = useState("");

  useEffect(() => {
    if (initialOpen && paid) {
      setOpen(true);
      if (alreadyJoined) setStep("card");
    }
  }, [initialOpen, paid, alreadyJoined]);

  // Load the Stripe intent once the card step is showing.
  useEffect(() => {
    if (!open || step !== "card" || !paid) return;
    let cancelled = false;
    setIntent(null);
    setIntentError("");
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
          await goToChannel();
        } else {
          setIntentError(data.error || "Could not start payment");
        }
      } catch {
        if (!cancelled) setIntentError("Could not start payment");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, ownerId, paid]);

  async function goToChannel() {
    try {
      const res = await fetch(`/api/payments/subscribe/link?ownerId=${ownerId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.link === "string" && data.link) {
        window.location.href = data.link;
        return;
      }
    } catch {}
    window.location.href = "/chat";
  }

  async function signup() {
    if (busy) return;
    if (!name.trim()) {
      setError("Enter your name");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter a valid email address");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        name: name.trim(),
        email: email.trim(),
        password,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || "Could not sign up");
      return;
    }
    if (paid) {
      if (!elementsEnabled()) {
        setError("Payments are not configured. Please try again later.");
        return;
      }
      setStep("card");
      return;
    }
    // Free profile: joining is enough — send them into the private channel.
    await goToChannel();
  }

  async function onCardSuccess(intentId: string) {
    const res = await fetch("/api/payments/subscribe/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerId,
        subscriptionId: intent?.subscriptionId,
        paymentIntentId:
          intent?.mode === "payment"
            ? intent.paymentIntentId || intentId
            : undefined,
      }),
    }).catch(() => null);
    if (res?.ok) {
      await goToChannel();
      return;
    }
    const data = await res?.json().catch(() => ({}));
    setIntentError(
      data?.error ||
        "Payment went through but activation failed — refresh the page."
    );
  }

  function openSheet() {
    if (!paid) {
      // Free profile: go through sign-up → chat.
      setStep("signup");
      setOpen(true);
      return;
    }
    setStep(alreadyJoined ? "card" : "signup");
    setOpen(true);
  }

  const button = (
    <button
      type="button"
      onClick={openSheet}
      className="w-full py-3 px-5 rounded-full bg-accent text-white text-sm font-semibold text-center active:opacity-80 transition-opacity"
    >
      {joinLabel}
    </button>
  );

  const inputClass =
    "w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent outline-none transition-colors";

  return (
    <>
      <div className="space-y-2">
        {button}
        {caption && (
          <p className="text-xs text-muted text-center">{caption}</p>
        )}
      </div>

      {open && (
        <Portal>
          <div
            className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-md flex items-end sm:items-center justify-center p-4"
            onClick={() => {
              // Keep the sheet open for returning unpaid fans who land here
              // mid-pay — they can still dismiss and see the profile.
              setOpen(false);
              setIntent(null);
              setIntentError("");
            }}
          >
            <div
              className="bg-card border border-line rounded-2xl p-5 w-full max-w-sm fade-up max-h-[90dvh] overflow-y-auto space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-bold">Join Private Telegram Channel</p>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setIntent(null);
                    setIntentError("");
                  }}
                  className="text-muted text-sm px-1"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              {step === "signup" ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted">
                    Create a free account, then{" "}
                    {paid
                      ? "add your card to join the channel."
                      : "join the private channel."}
                  </p>
                  <input
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    maxLength={40}
                    className={inputClass}
                  />
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email address"
                    maxLength={254}
                    className={inputClass}
                  />
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a password"
                      minLength={6}
                      className={`${inputClass} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg transition-colors p-1"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? (
                        <IconEyeOff className="w-5 h-5" />
                      ) : (
                        <IconEye className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                  {error && (
                    <p className="text-red-400 text-sm text-center">{error}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void signup()}
                    disabled={
                      busy ||
                      !name.trim() ||
                      !email.trim() ||
                      password.length < 6
                    }
                    className="w-full bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-40 active:opacity-80 transition-opacity"
                  >
                    {busy
                      ? "Signing up…"
                      : paid
                        ? "Continue to payment"
                        : "Join the channel"}
                  </button>
                </div>
              ) : intentError ? (
                <p className="text-red-400 text-sm">{intentError}</p>
              ) : !intent ? (
                <div className="py-10 flex items-center justify-center">
                  <span className="w-6 h-6 rounded-full border-2 border-line border-t-accent animate-spin" />
                </div>
              ) : (
                <EmbeddedCardTopup
                  clientSecret={intent.clientSecret}
                  mode={intent.mode}
                  amountCents={
                    intent.mode === "setup" || plan.trialDays > 0
                      ? 0
                      : plan.priceCents
                  }
                  label={
                    plan.trialDays > 0
                      ? `${plan.trialDays}-day free trial`
                      : plan.interval === "lifetime"
                        ? "Lifetime channel access"
                        : plan.interval === "day"
                          ? "Daily channel access"
                          : plan.interval === "week"
                            ? "Weekly channel access"
                            : "Monthly channel access"
                  }
                  // The sheet header already has a ✕ — one close button only.
                  hideClose
                  countryGuess={null}
                  onSuccess={onCardSuccess}
                  onCancel={() => {
                    setOpen(false);
                    setIntent(null);
                  }}
                />
              )}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
