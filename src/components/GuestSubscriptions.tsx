"use client";

import { useEffect, useState } from "react";
import Portal from "./Portal";
import { IconGear, IconUser, IconVerified } from "./Icons";
import { ensurePhantomOrRedirect, isPhantomCancel, payWithPhantom } from "@/lib/phantom";
import { trackSubscribe } from "@/lib/metaPixel";

type Subscription = {
  ownerId: string;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
  status: string;
  live: boolean;
  priceCents: number;
  interval: string;
  currentPeriodEnd: string | null;
  nextChargeCents: number;
  planInterval: string;
};

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

function priceLabel(sub: Subscription): string {
  if (sub.interval === "lifetime") return "Lifetime access";
  return `${dollars(sub.priceCents)} / ${sub.interval}`;
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
 * Fan Profile tab → the creators they subscribe to. Nothing renews on its
 * own: each row's sheet shows when access ends and pays the next period in
 * USDC from Phantom (paying early adds to the current period).
 */
export default function GuestSubscriptions() {
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [openFor, setOpenFor] = useState<Subscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
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

  async function payNext(sub: Subscription) {
    if (busy) return;
    if (!ensurePhantomOrRedirect()) {
      setError("Install the Phantom wallet, then come back to this page.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await payWithPhantom({ subscribeOwnerId: sub.ownerId }, setStatus);
      trackSubscribe(sub.nextChargeCents, 0);
      setStatus(null);
      setOpenFor(null);
      await load();
    } catch (err) {
      setStatus(null);
      setError(
        isPhantomCancel(err)
          ? "Payment cancelled in Phantom."
          : err instanceof Error
            ? err.message
            : "Could not complete the payment"
      );
    }
    setBusy(false);
  }

  function closeSheet() {
    if (busy) return;
    setOpenFor(null);
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
          const end = dateLabel(sub.currentPeriodEnd);
          const detail =
            sub.interval === "lifetime"
              ? "Lifetime access"
              : !sub.live
                ? `${priceLabel(sub)} · expired${end ? ` ${end}` : ""}`
                : sub.status === "trialing"
                  ? `Free trial${end ? ` · ends ${end}` : ""}`
                  : `${priceLabel(sub)}${end ? ` · until ${end}` : ""}`;
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
                  <IconVerified className="w-5 h-5 text-accent shrink-0" />
                </p>
                <p className={`text-xs truncate ${sub.live ? "text-muted" : "text-red-400"}`}>
                  {detail}
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
                {periodEnd && sheetSub.interval !== "lifetime" && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">
                      {!sheetSub.live
                        ? "Access ended"
                        : sheetSub.status === "trialing"
                          ? "Trial ends"
                          : "Access until"}
                    </span>
                    <span className="font-semibold">{periodEnd}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted">Status</span>
                  <span className="font-semibold">
                    {!sheetSub.live
                      ? "Expired"
                      : sheetSub.status === "trialing"
                        ? "Free trial"
                        : "Active"}
                  </span>
                </div>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              {sheetSub.interval === "lifetime" ? (
                <p className="text-xs text-muted text-center">
                  You have lifetime access — nothing more to pay.
                </p>
              ) : sheetSub.nextChargeCents > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted text-center">
                    Nothing renews on its own. Pay the next {sheetSub.planInterval} in USDC
                    from Phantom whenever you like — paying early adds to your current
                    access.
                  </p>
                  <button
                    onClick={() => void payNext(sheetSub)}
                    disabled={busy}
                    className="w-full bg-[#AB9FF2] text-[#1C1C1C] rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 active:opacity-80 transition-opacity"
                  >
                    {status ??
                      `Pay ${dollars(sheetSub.nextChargeCents)} for 1 ${sheetSub.planInterval} · Phantom`}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted text-center">
                  This creator&apos;s chat is free now — nothing to pay.
                </p>
              )}
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
