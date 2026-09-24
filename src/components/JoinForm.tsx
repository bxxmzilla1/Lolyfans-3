"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SubPlan } from "@/lib/subscriptionPlan";
import { trackLead, trackSignup, trackSubscribe } from "@/lib/metaPixel";
import SubscribeCheckout from "./SubscribeCheckout";
import { IconEye, IconEyeOff } from "./Icons";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Guest sign-up: name + email + password. After join, drop the fan straight
 * into their private chat with the creator.
 */
export default function JoinForm({
  code,
  buttonText,
  ownerName,
}: {
  code: string;
  buttonText?: string;
  ownerId?: string;
  ownerName?: string;
  plan?: SubPlan | null;
  initialPayStep?: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  // Paid profile, no verified card yet: the card step replaces the form.
  const [cardStep, setCardStep] = useState<{ ownerId: string; plan: SubPlan } | null>(
    null
  );
  const router = useRouter();

  async function afterJoined() {
    setOpening(true);
    router.push("/chat");
    router.refresh();
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
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
      setError(data?.error || "Could not join");
      return;
    }
    const created = !!data?.created;
    if (created) trackSignup("invite_signup");
    if (data?.requiresCard && data.ownerId && data.plan) {
      // Paid / free-trial chat: the lead fires once the card is verified.
      setBusy(false);
      setCardStep({ ownerId: data.ownerId, plan: data.plan as SubPlan });
      return;
    }
    // Free chat (or card already verified elsewhere): the signup is the lead.
    if (created) {
      trackLead(
        (data?.plan as SubPlan | undefined) ?? { priceCents: 0, trialDays: 0 },
        "invite_signup"
      );
    }
    await afterJoined();
  }

  const inputClass =
    "w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent transition-colors";

  if (cardStep) {
    const { plan } = cardStep;
    return (
      <div className="w-full space-y-3">
        <SubscribeCheckout
          ownerId={cardStep.ownerId}
          ownerName={ownerName}
          plan={plan}
          onSuccess={() => {
            trackSubscribe(plan.priceCents, plan.trialDays);
            // Paid / free-trial chat: verified card = the lead (once per fan).
            trackLead(plan, "invite_signup");
            void afterJoined();
          }}
        />
        {opening && (
          <div className="fixed inset-0 z-50 bg-bg flex items-center justify-center fade-up">
            <p className="text-muted text-sm">Opening…</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <form onSubmit={join} className="w-full flex flex-col gap-3">
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
          type="submit"
          disabled={busy || !name.trim() || !email.trim() || password.length < 6}
          className="w-full bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-40 active:opacity-80 transition-opacity"
        >
          {busy ? "Signing up…" : buttonText?.trim() || "Start chatting"}
        </button>
      </form>

      {opening && (
        <div className="fixed inset-0 z-50 bg-bg flex items-center justify-center fade-up">
          <p className="text-muted text-sm">Opening…</p>
        </div>
      )}
    </>
  );
}
