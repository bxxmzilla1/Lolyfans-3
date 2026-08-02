"use client";

import { useEffect, useState } from "react";
import Portal from "./Portal";
import { IconGear, IconUser, IconVerified } from "./Icons";

type Subscription = {
  ownerId: string;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
  status: string;
  priceCents: number;
  interval: string;
  currentPeriodEnd: string | null;
};

const INTERVAL_ADVERB: Record<string, string> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
};

function priceLabel(sub: Subscription): string {
  if (sub.interval === "lifetime") return "Lifetime access";
  const dollars = `$${(sub.priceCents / 100).toFixed(2).replace(/\.00$/, "")}`;
  return `${dollars} / ${sub.interval}`;
}

function dateLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Fan Profile tab → the creators they're paying for. Each row's settings
 * button opens a sheet where the recurring charge can be cancelled; access
 * runs to the end of the period they already paid for.
 */
export default function GuestSubscriptions() {
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [openFor, setOpenFor] = useState<Subscription | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/guest/subscriptions");
      const data = await res.json().catch(() => ({}));
      setSubs(res.ok ? (data.subscriptions ?? []) : []);
    } catch {
      setSubs([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function cancel(sub: Subscription) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/payments/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: sub.ownerId, action: "cancel" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setConfirming(false);
        setOpenFor(null);
        await load();
      } else {
        setError(data.error || "Could not cancel subscription");
      }
    } catch {
      setError("Could not cancel subscription");
    }
    setBusy(false);
  }

  function closeSheet() {
    if (busy) return;
    setOpenFor(null);
    setConfirming(false);
    setError("");
  }

  if (subs === null) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Subscriptions
        </p>
        {[...Array(2)].map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-line2 bg-card px-3 py-3 animate-pulse"
          >
            <div className="w-11 h-11 rounded-full bg-card2" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-card2 rounded w-1/3" />
              <div className="h-3 bg-card2 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (subs.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Subscriptions
        </p>
        <p className="text-sm text-muted rounded-xl border border-line2 bg-card px-4 py-4 text-center">
          You&apos;re not subscribed to anyone yet.
        </p>
      </div>
    );
  }

  const sheetSub = openFor;
  const periodEnd = sheetSub ? dateLabel(sheetSub.currentPeriodEnd) : null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted uppercase tracking-wide">
        Subscriptions
      </p>

      <ul className="space-y-2">
        {subs.map((sub) => {
          const canceling = sub.status === "canceling";
          const renewal = dateLabel(sub.currentPeriodEnd);
          return (
            <li
              key={sub.ownerId}
              className="flex items-center gap-3 rounded-xl border border-line2 bg-card px-3 py-3"
            >
              {sub.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sub.avatarUrl}
                  alt={sub.name}
                  className="w-11 h-11 rounded-full object-cover bg-card2 shrink-0"
                />
              ) : (
                <div className="w-11 h-11 rounded-full bg-card2 flex items-center justify-center shrink-0">
                  <IconUser className="w-5 h-5 text-muted" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm flex items-center gap-1 min-w-0">
                  <span className="truncate">{sub.name}</span>
                  {sub.verified && (
                    <IconVerified className="w-4 h-4 text-sky-500 shrink-0" />
                  )}
                </p>
                <p className="text-xs text-muted truncate">
                  {sub.status === "trialing"
                    ? `Free trial · then ${priceLabel(sub)}`
                    : priceLabel(sub)}
                  {canceling
                    ? renewal
                      ? ` · ends ${renewal}`
                      : " · cancelled"
                    : renewal
                      ? ` · renews ${renewal}`
                      : ""}
                </p>
              </div>

              <button
                onClick={() => setOpenFor(sub)}
                aria-label={`Subscription settings for ${sub.name}`}
                className="shrink-0 w-9 h-9 rounded-xl border border-line2 bg-card2 text-muted hover:text-fg flex items-center justify-center transition-colors"
              >
                <IconGear className="w-4.5 h-4.5" />
              </button>
            </li>
          );
        })}
      </ul>

      {sheetSub && (
        <Portal>
          <div
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
            onClick={closeSheet}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-card border border-line rounded-2xl p-5 space-y-4 fade-up"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-bold truncate">{sheetSub.name}</p>
                <button
                  onClick={closeSheet}
                  className="text-muted text-sm px-1"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="rounded-xl bg-card2 border border-line px-3.5 py-3 text-sm space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted">Plan</span>
                  <span className="font-semibold">{priceLabel(sheetSub)}</span>
                </div>
                {periodEnd && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">
                      {sheetSub.status === "canceling"
                        ? "Access until"
                        : "Next charge"}
                    </span>
                    <span className="font-semibold">{periodEnd}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted">Status</span>
                  <span className="font-semibold capitalize">
                    {sheetSub.status === "canceling"
                      ? "Cancelled"
                      : sheetSub.status === "trialing"
                        ? "Free trial"
                        : sheetSub.status}
                  </span>
                </div>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              {sheetSub.status === "canceling" ? (
                <p className="text-xs text-muted text-center">
                  This subscription is already cancelled and won&apos;t be
                  charged again.
                </p>
              ) : sheetSub.interval === "lifetime" ? (
                <p className="text-xs text-muted text-center">
                  You have lifetime access — there&apos;s nothing to cancel.
                </p>
              ) : confirming ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted">
                    Cancel your{" "}
                    {INTERVAL_ADVERB[sheetSub.interval] ?? "recurring"}{" "}
                    subscription to {sheetSub.name}? You keep access
                    {periodEnd ? ` until ${periodEnd}` : " until the end of the period you paid for"}
                    , and your card won&apos;t be charged again.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirming(false)}
                      disabled={busy}
                      className="flex-1 bg-card2 border border-line rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
                    >
                      Keep it
                    </button>
                    <button
                      onClick={() => void cancel(sheetSub)}
                      disabled={busy}
                      className="flex-1 bg-red-500 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 active:opacity-80 transition-opacity"
                    >
                      {busy ? "Cancelling…" : "Cancel it"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(true)}
                  className="w-full bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl py-2.5 text-sm font-semibold hover:bg-red-500/20 transition-colors"
                >
                  Cancel subscription
                </button>
              )}
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
