"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SubscribeCheckout from "./SubscribeCheckout";
import { elementsEnabled } from "@/lib/stripeClient";
import type { SubPlan } from "@/lib/subscriptionPlan";
import { IconEye, IconEyeOff } from "./Icons";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Guest sign-up: name, email and password — no verification step. On paid
 * profiles, the card form appears as step 2 right here, so the fan never
 * types their name and email twice.
 */
export default function JoinForm({
  code,
  buttonText,
  ownerId,
  ownerName,
  plan,
}: {
  code: string;
  buttonText?: string;
  ownerId?: string;
  ownerName?: string;
  plan?: SubPlan | null;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [payStep, setPayStep] = useState(false);
  const [opening, setOpening] = useState(false);
  const router = useRouter();

  function openChat() {
    // Loading skeleton so the page never looks frozen while /chat renders.
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
    if (!res.ok) {
      setBusy(false);
      const data = await res.json().catch(() => null);
      setError(data?.error || "Could not join this chat");
      return;
    }

    // Paid profile → collect the card right here (account already created,
    // so their name/email carry over to Stripe automatically).
    if (ownerId && (plan?.priceCents ?? 0) > 0 && elementsEnabled()) {
      setBusy(false);
      setPayStep(true);
      return;
    }
    openChat();
  }

  if (payStep && ownerId && plan) {
    return (
      <>
        <div className="w-full flex flex-col gap-4">
          <SubscribeCheckout
            ownerId={ownerId}
            ownerName={ownerName}
            plan={plan}
            onSuccess={openChat}
          />
          <button
            type="button"
            onClick={openChat}
            className="text-xs text-muted hover:text-fg transition-colors mx-auto"
          >
            Maybe later — take me to the chat
          </button>
        </div>
        {opening && <OpeningSkeleton />}
      </>
    );
  }

  const inputClass =
    "w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent transition-colors";

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

      {/* Chat skeleton shown from sign-up until /chat finishes loading,
          so the page never looks frozen. */}
      {opening && <OpeningSkeleton />}
    </>
  );
}

function OpeningSkeleton() {
  return (
    <div className="fixed inset-0 z-50 bg-bg flex flex-col fade-up">
      <div className="border-b border-line2 px-4 py-3 flex items-center gap-3 bg-card/60">
        <div className="w-11 h-11 rounded-full bg-card2 animate-pulse" />
        <div className="space-y-1.5">
          <div className="h-3 w-28 rounded-full bg-card2 animate-pulse" />
          <div className="h-2.5 w-16 rounded-full bg-card2 animate-pulse" />
        </div>
      </div>
      <div className="flex-1 p-4 space-y-3 overflow-hidden">
        <div className="h-10 w-44 rounded-3xl rounded-bl-lg bg-card2 animate-pulse" />
        <div className="h-10 w-56 rounded-3xl rounded-bl-lg bg-card2 animate-pulse" />
        <div className="h-10 w-40 rounded-3xl rounded-br-lg bg-accent/25 animate-pulse ml-auto" />
        <div className="h-10 w-52 rounded-3xl rounded-bl-lg bg-card2 animate-pulse" />
      </div>
      <div className="p-3">
        <div className="h-12 rounded-2xl bg-card2 border border-line animate-pulse" />
      </div>
      <p className="absolute inset-x-0 top-1/2 text-center text-muted text-sm">
        Opening chat…
      </p>
    </div>
  );
}
