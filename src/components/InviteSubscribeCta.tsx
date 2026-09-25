"use client";

import { useState } from "react";
import Portal from "./Portal";
import { trackLead, trackSignup, trackSubscribe } from "@/lib/metaPixel";
import {
  subButtonLabels,
  subCaption,
  subCtaLabel,
  subDollars,
  subFirstPeriodCents,
  type SubPlan,
} from "@/lib/subscriptionPlan";
import {
  ensurePhantomOrRedirect,
  isPhantomCancel,
  payWithPhantom,
  signInWithPhantom,
} from "@/lib/phantom";

const FREE_PLAN: SubPlan = {
  priceCents: 0,
  interval: "month",
  trialDays: 0,
  discountPct: 0,
};

const PHANTOM_BTN =
  "w-full bg-[#AB9FF2] text-[#1C1C1C] font-semibold rounded-xl py-3 disabled:opacity-40 active:opacity-80 transition-opacity flex items-center justify-center gap-2";

function PhantomMark({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" className={className} aria-hidden="true">
      <circle cx="64" cy="64" r="64" fill="#1C1C1C" />
      <path
        fill="#AB9FF2"
        d="M110 65c0 24-19 44-42 44-18 0-27-10-33-21-3-6-9-4-12 2-3 5-7 10-12 10-4 0-7-3-7-7 0-6 6-9 6-15 0-9 1-18 7-27C25 38 41 21 66 21c25 0 44 19 44 44Zm-60-6a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm25 0a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"
      />
    </svg>
  );
}

/**
 * The whole fan sign-up: "Continue with Phantom" (a free message signature
 * proves the wallet), then — on paid profiles without a running trial or
 * paid period — one USDC payment for the first period. Lands in the chat.
 */
export function WalletJoinFlow({
  code,
  ownerId,
  ownerName,
  plan: planProp,
  startAtPay = false,
  chargeCents,
  source,
  buttonText,
}: {
  code: string;
  ownerId: string;
  ownerName?: string;
  plan?: SubPlan | null;
  /** Fan already signed up but owes this period: go straight to payment. */
  startAtPay?: boolean;
  /** Exact amount due now (server-computed); defaults to the first-period price. */
  chargeCents?: number | null;
  source: string;
  buttonText?: string;
}) {
  const [step, setStep] = useState<"connect" | "pay">(startAtPay ? "pay" : "connect");
  const [plan, setPlan] = useState<SubPlan>(planProp ?? FREE_PLAN);
  const [due, setDue] = useState<number | null>(chargeCents ?? null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const paid = plan.priceCents > 0;
  const amountDue = due ?? subFirstPeriodCents(plan);

  async function connect() {
    if (busy) return;
    if (!ensurePhantomOrRedirect()) {
      setError("Install the Phantom wallet, then come back to this page.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Sign the message in Phantom…");
    try {
      const signed = await signInWithPhantom();
      setStatus("Opening your chat…");
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, ...signed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not sign up");
      const created = !!data?.created;
      const effectivePlan = (data?.plan as SubPlan | undefined) ?? plan;
      if (created) {
        trackSignup(source);
        // Signing up with the wallet is the lead.
        trackLead(effectivePlan, source);
      }
      if (data?.requiresPayment) {
        setPlan(effectivePlan);
        setDue(subFirstPeriodCents(effectivePlan));
        setStatus(null);
        setBusy(false);
        setStep("pay");
        return;
      }
      window.location.href = "/chat";
    } catch (err) {
      setStatus(null);
      setBusy(false);
      setError(
        isPhantomCancel(err)
          ? "Cancelled in Phantom."
          : err instanceof Error
            ? err.message
            : "Could not sign up"
      );
    }
  }

  async function pay() {
    if (busy) return;
    if (!ensurePhantomOrRedirect()) {
      setError("Install the Phantom wallet, then come back to this page.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await payWithPhantom({ subscribeOwnerId: ownerId }, setStatus);
      trackSubscribe(plan.priceCents, plan.trialDays);
      setStatus("Opening your chat…");
      window.location.href = "/chat";
    } catch (err) {
      setStatus(null);
      setBusy(false);
      setError(
        isPhantomCancel(err)
          ? "Payment cancelled in Phantom."
          : err instanceof Error
            ? err.message
            : "Could not complete the payment"
      );
    }
  }

  if (step === "pay") {
    const periodLabel =
      plan.interval === "lifetime" ? "Lifetime access" : `Access for 1 ${plan.interval}`;
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-card2 border border-line px-3.5 py-3 text-sm space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">{ownerName ? `${ownerName} · ` : ""}Subscription</span>
            <span className="font-semibold">{subCtaLabel(plan)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">{periodLabel}</span>
            <span className="font-semibold">{subDollars(amountDue)} USDC</span>
          </div>
        </div>
        <p className="text-xs text-muted">
          Paid in USDC from your Phantom wallet. Nothing renews on its own — when
          the period ends you decide whether to pay for the next one.
        </p>
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        <button type="button" onClick={() => void pay()} disabled={busy} className={PHANTOM_BTN}>
          <PhantomMark />
          {status ?? `Pay ${subDollars(amountDue)} with Phantom`}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {paid
          ? `Sign in with your Phantom wallet. ${subCaption(plan) ?? ""}`
          : "Sign in with your Phantom wallet to start chatting. No email, no password."}
      </p>
      {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      <button type="button" onClick={() => void connect()} disabled={busy} className={PHANTOM_BTN}>
        <PhantomMark />
        {status ?? (buttonText?.trim() || "Continue with Phantom")}
      </button>
    </div>
  );
}

/**
 * Sign-up sheet shown over a creator's profile. `startAtPay` reopens it at
 * the USDC payment step for fans who already have an account but owe the
 * current period.
 */
export function JoinChannelSheet({
  code,
  ownerId,
  ownerName,
  plan,
  startAtPay = false,
  chargeCents,
  onClose,
}: {
  code: string;
  ownerId: string;
  ownerName?: string;
  plan?: SubPlan | null;
  startAtPay?: boolean;
  chargeCents?: number | null;
  onClose: () => void;
}) {
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
            <p className="font-bold">{startAtPay ? "Continue your subscription" : "Join my private chat"}</p>
            <button
              type="button"
              onClick={onClose}
              className="text-muted text-sm px-1"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <WalletJoinFlow
            code={code}
            ownerId={ownerId}
            ownerName={ownerName}
            plan={plan}
            startAtPay={startAtPay}
            chargeCents={chargeCents}
            source="subscribe_sheet"
          />
        </div>
      </div>
    </Portal>
  );
}

/**
 * Invite-profile "Join my private chat" button. Opens the sign-up sheet over
 * the profile; paid profiles add the USDC step; then the fan lands in chat.
 */
export default function InviteSubscribeCta({
  code,
  ownerId,
  ownerName,
  plan,
  initialOpen = false,
  alreadyJoined = false,
  chargeCents,
}: {
  code: string;
  ownerId: string;
  ownerName?: string;
  plan?: SubPlan | null;
  /** Open the sheet immediately (returning unpaid fan → payment step). */
  initialOpen?: boolean;
  /** Fan already has an account: skip sign-in, go to the payment step. */
  alreadyJoined?: boolean;
  chargeCents?: number | null;
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
          startAtPay={alreadyJoined && paid}
          chargeCents={chargeCents}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
