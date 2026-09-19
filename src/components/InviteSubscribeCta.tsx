"use client";

import { useState } from "react";
import Portal from "./Portal";
import SubscribeCheckout from "./SubscribeCheckout";
import { trackSignup, trackSubscribe } from "@/lib/metaPixel";
import {
  subButtonLabels,
  subCaption,
  subCtaLabel,
  type SubPlan,
} from "@/lib/subscriptionPlan";
import { IconEye, IconEyeOff } from "./Icons";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const FREE_PLAN: SubPlan = {
  priceCents: 0,
  interval: "month",
  trialDays: 0,
  discountPct: 0,
};

/** Headline for the card step. */
export function cardTitle(plan: SubPlan): string {
  return plan.trialDays > 0 ? "Start your free trial" : "Add your card";
}

/**
 * Sign-up sheet shown over a creator's profile: name + email + password,
 * then — for paid profiles — the card step (Stripe) before the chat opens.
 * `startAtCard` reopens the sheet straight at the card step for fans who
 * already have an account but haven't added a card yet.
 */
export function JoinChannelSheet({
  code,
  ownerId,
  ownerName,
  plan: planProp,
  startAtCard = false,
  onClose,
}: {
  code: string;
  ownerId: string;
  ownerName?: string;
  plan?: SubPlan | null;
  startAtCard?: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"account" | "card">(
    startAtCard ? "card" : "account"
  );
  const [plan, setPlan] = useState<SubPlan>(planProp ?? FREE_PLAN);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const paid = plan.priceCents > 0;

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
    if (!res.ok) {
      setBusy(false);
      setError(data?.error || "Could not sign up");
      return;
    }
    if (data?.created) trackSignup("subscribe_sheet");
    if (data?.requiresCard) {
      // Paid profile, no verified card yet → collect it before the chat.
      if (data.plan) setPlan(data.plan as SubPlan);
      setBusy(false);
      setStep("card");
      return;
    }
    window.location.href = "/chat";
  }

  function cardDone() {
    trackSubscribe(plan.priceCents, plan.trialDays);
    window.location.href = "/chat";
  }

  const inputClass =
    "w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent outline-none transition-colors";

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-md flex items-end sm:items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="bg-card border border-line rounded-2xl p-5 w-full max-w-sm fade-up max-h-[90dvh] overflow-y-auto space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="font-bold">
              {step === "card" ? cardTitle(plan) : "Join my private chat"}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="text-muted text-sm px-1"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {step === "card" ? (
            <div className="space-y-3">
              <SubscribeCheckout
                ownerId={ownerId}
                ownerName={ownerName}
                plan={plan}
                onSuccess={cardDone}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted">
                {paid
                  ? `Create your account, then add your card. ${subCaption(plan) ?? ""}`
                  : "Create a free account to start chatting."}
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
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <IconEyeOff className="w-5 h-5" />
                  ) : (
                    <IconEye className="w-5 h-5" />
                  )}
                </button>
              </div>
              {error && <p className="text-red-400 text-sm text-center">{error}</p>}
              <button
                type="button"
                onClick={() => void signup()}
                disabled={busy || !name.trim() || !email.trim() || password.length < 6}
                className="w-full bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-40 active:opacity-80 transition-opacity"
              >
                {busy ? "Joining…" : paid ? "Continue" : "Start chatting"}
              </button>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

/**
 * Invite-profile "Join my private chat" button. Opens the sign-up sheet over
 * the profile; paid profiles add the card step; then the fan lands in chat.
 */
export default function InviteSubscribeCta({
  code,
  ownerId,
  ownerName,
  plan,
  initialOpen = false,
  alreadyJoined = false,
}: {
  code: string;
  ownerId: string;
  ownerName?: string;
  plan?: SubPlan | null;
  /** Open the sheet immediately (returning unpaid fan → card step). */
  initialOpen?: boolean;
  /** Fan already has an account: skip the form, go to the card step. */
  alreadyJoined?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const effectivePlan = plan ?? FREE_PLAN;
  const paid = effectivePlan.priceCents > 0;
  const caption = paid ? subCaption(effectivePlan) : "Free to join";
  // Paid plans use the same wording as the public profile bar; free links
  // keep "JOIN MY PRIVATE CHAT · FREE".
  const labels = paid
    ? subButtonLabels(effectivePlan)
    : { left: "JOIN MY PRIVATE CHAT", right: subCtaLabel(effectivePlan) };

  return (
    <>
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full py-3 px-5 rounded-full bg-accent text-white text-sm font-semibold active:opacity-80 transition-opacity flex items-center justify-between"
        >
          <span>{labels.left}</span>
          <span>{labels.right}</span>
        </button>
        {caption && <p className="text-xs text-muted text-center">{caption}</p>}
      </div>

      {open && (
        <JoinChannelSheet
          code={code}
          ownerId={ownerId}
          ownerName={ownerName}
          plan={effectivePlan}
          startAtCard={alreadyJoined && paid}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
