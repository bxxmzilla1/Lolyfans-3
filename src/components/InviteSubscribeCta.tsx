"use client";

import { useEffect, useRef, useState } from "react";
import Portal from "./Portal";
import EmbeddedCardTopup from "./EmbeddedCardTopup";
import { elementsEnabled } from "@/lib/stripeClient";
import { subCaption, type SubPlan } from "@/lib/subscriptionPlan";
import { IconEye, IconEyeOff } from "./Icons";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Payload the Telegram Login Widget hands to the onauth callback. */
type TgAuthUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

// Each CTA instance gets its own global onauth callback name, so the two
// copies on the invite profile page never clobber each other.
let widgetSeq = 0;

type Intent = {
  mode: "payment" | "setup";
  clientSecret: string;
  subscriptionId?: string;
  paymentIntentId?: string;
};

/**
 * Invite-profile join CTA. When the Telegram Login Widget is configured, the
 * button IS the widget: one tap logs the fan in with their Telegram identity,
 * creates their account from it (no name/email/password form), then opens the
 * Stripe card sheet (paid) or goes straight into the channel (free). Without
 * the widget it falls back to the classic sign-up form + card wizard, all
 * over this profile page — no navigation away to /signup.
 */
export default function InviteSubscribeCta({
  code,
  ownerId,
  plan,
  /** Returning unpaid guest — open the card sheet immediately. */
  initialOpen = false,
  /** Already has a guest session for this creator (skip the sign-up form). */
  alreadyJoined = false,
  /** Login-widget bot (@ stripped); null = widget not configured. */
  botUsername = null,
  /** Fan already logged in with Telegram (from the cookie). */
  tgLoggedIn = false,
}: {
  code: string;
  ownerId: string;
  /** Kept for callers; the sheet no longer shows the creator's name. */
  ownerName?: string;
  plan: SubPlan;
  initialOpen?: boolean;
  alreadyJoined?: boolean;
  botUsername?: string | null;
  tgLoggedIn?: boolean;
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
  // Telegram widget path: joining state + errors shown under the CTA itself.
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [tgReady, setTgReady] = useState(tgLoggedIn);
  const widgetRef = useRef<HTMLDivElement>(null);
  const [cbName] = useState(() => `onTelegramAuthCta${++widgetSeq}`);

  // The widget replaces the join button for brand-new visitors only;
  // returning guests (unpaid) keep the button that reopens the card sheet.
  const useWidget = !!botUsername && !alreadyJoined && !tgReady;

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
    // No channel configured yet — land on the fan home feed.
    window.location.href = "/home";
  }

  /**
   * Telegram path: the widget (or an earlier login cookie) already verified
   * who they are — create/resume their account from that identity, then open
   * the card sheet (paid) or go straight into the channel (free).
   */
  async function tgJoin() {
    if (joining) return;
    setJoining(true);
    setJoinError("");
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, telegram: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setJoining(false);
        setJoinError(data?.error || "Could not join");
        return;
      }
      if (data.needsPayment) {
        setJoining(false);
        if (!elementsEnabled()) {
          setJoinError("Payments are not configured. Please try again later.");
          return;
        }
        setStep("card");
        setOpen(true);
        return;
      }
      // Free profile — joining stays true while we navigate to Telegram.
      await goToChannel();
    } catch {
      setJoining(false);
      setJoinError("Could not join");
    }
  }

  // Mount the Telegram Login Widget in place of the join button. It replaces
  // the script tag with an iframe button and calls our per-instance global
  // callback with the signed payload, which /api/telegram/auth verifies.
  useEffect(() => {
    const holder = widgetRef.current;
    if (!useWidget || !botUsername || !holder) return;

    const w = window as unknown as Record<string, unknown>;
    w[cbName] = async (user: TgAuthUser) => {
      setJoinError("");
      try {
        const res = await fetch("/api/telegram/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          setJoinError(data.error || "Telegram login failed");
          return;
        }
        setTgReady(true);
        await tgJoin();
      } catch {
        setJoinError("Telegram login failed");
      }
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "24");
    script.setAttribute("data-onauth", `${cbName}(user)`);
    holder.appendChild(script);

    return () => {
      holder.innerHTML = "";
      delete w[cbName];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useWidget, botUsername, cbName]);

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

  // Brand-new visitor with the widget configured → the button IS the widget.
  // Returning guests / already-logged-in Telegram fans get the classic button
  // (which resumes the card sheet or joins with their Telegram identity).
  const button = useWidget ? (
    <div ref={widgetRef} className="flex justify-center min-h-11" />
  ) : (
    <button
      type="button"
      onClick={
        alreadyJoined || !botUsername ? openSheet : () => void tgJoin()
      }
      disabled={joining}
      className="w-full py-3 px-5 rounded-full bg-accent text-white text-sm font-semibold text-center active:opacity-80 transition-opacity disabled:opacity-60"
    >
      {joining ? "Joining…" : joinLabel}
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
        {joinError && (
          <p className="text-xs text-red-400 text-center">{joinError}</p>
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
