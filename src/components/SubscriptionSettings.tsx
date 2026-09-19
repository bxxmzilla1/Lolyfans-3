"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { subDollars } from "@/lib/subscriptionPlan";
import { IconCard, IconCheck } from "./Icons";

const inputClass =
  "w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent outline-none transition-colors";

/**
 * Settings → Subscription: FREE (plain sign-up) or PAID (fans add a card
 * right after creating their account). PAID can start with a free trial of
 * a custom number of days — the card is verified, nothing is charged until
 * the trial ends. Stored in the creator's auth metadata (sub_* keys).
 */
export default function SubscriptionSettings() {
  const [loaded, setLoaded] = useState(false);
  const [paid, setPaid] = useState(false);
  const [price, setPrice] = useState("9.99");
  const [trial, setTrial] = useState(false);
  const [trialDays, setTrialDays] = useState("7");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
        const cents = Math.max(0, Math.round(Number(meta.sub_price_cents) || 0));
        const days = Math.max(0, Math.floor(Number(meta.sub_trial_days) || 0));
        setPaid(cents > 0);
        if (cents > 0) setPrice((cents / 100).toFixed(2));
        setTrial(days > 0);
        if (days > 0) setTrialDays(String(days));
        setLoaded(true);
      });
  }, []);

  const priceCents = Math.round(parseFloat(price || "0") * 100);
  const days = Math.floor(Number(trialDays) || 0);
  const priceValid = !paid || (priceCents >= 100 && priceCents <= 99900);
  const trialValid = !paid || !trial || (days >= 1 && days <= 365);

  async function save() {
    if (saving || !priceValid || !trialValid) return;
    setSaving(true);
    setError("");
    const { error } = await supabaseBrowser().auth.updateUser({
      data: {
        sub_price_cents: paid ? priceCents : 0,
        sub_interval: "month",
        sub_trial_days: paid && trial ? days : 0,
        sub_discount_pct: 0,
      },
    });
    setSaving(false);
    if (error) {
      setError(error.message || "Could not save — try again");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const modeButton = (active: boolean) =>
    `rounded-2xl border p-4 text-left transition-colors ${
      active
        ? "border-accent ring-1 ring-accent bg-card"
        : "border-line bg-card hover:bg-card2/60"
    }`;

  if (!loaded) {
    return (
      <div className="space-y-3 max-w-2xl">
        {[0, 1].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-card2 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-2xl border border-line bg-card p-4 space-y-1">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <IconCard className="w-4 h-4 text-accent" /> Subscription method
        </p>
        <p className="text-xs text-muted">
          How fans get into your chat. With a paid subscription, the Stripe
          card sheet appears right after they enter their name, email and
          password — their card is verified and saved, so every purchase
          after that is one tap.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button type="button" onClick={() => setPaid(false)} className={modeButton(!paid)}>
          <span className="flex items-center justify-between">
            <span className="font-semibold text-sm">FREE</span>
            {!paid && <IconCheck className="w-4 h-4 text-accent" />}
          </span>
          <span className="block text-xs text-muted mt-1">
            Fans sign up and chat right away. No card is collected until they
            buy something.
          </span>
        </button>
        <button type="button" onClick={() => setPaid(true)} className={modeButton(paid)}>
          <span className="flex items-center justify-between">
            <span className="font-semibold text-sm">PAID SUBSCRIPTION</span>
            {paid && <IconCheck className="w-4 h-4 text-accent" />}
          </span>
          <span className="block text-xs text-muted mt-1">
            Fans add a card after signing up. Monthly billing through Stripe,
            with an optional free trial.
          </span>
        </button>
      </div>

      {paid && (
        <div className="rounded-2xl border border-line bg-card p-4 space-y-4 fade-up">
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">Monthly price (USD)</p>
            <div className="flex items-center bg-card2 border border-line rounded-xl focus-within:border-accent transition-colors">
              <span className="pl-4 text-muted text-[15px] select-none">$</span>
              <input
                type="number"
                min={1}
                max={999}
                step="0.01"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="flex-1 min-w-0 bg-transparent py-3 px-2 text-[15px] outline-none"
              />
              <span className="pr-4 text-muted text-sm select-none">/ month</span>
            </div>
            {!priceValid && (
              <p className="text-xs text-red-400">Enter a price between $1 and $999.</p>
            )}
          </div>

          <div className="flex items-start justify-between gap-4 border-t border-line pt-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Free trial</p>
              <p className="text-xs text-muted">
                Fans verify their card but pay $0 today. The first charge
                happens when the trial ends, unless they cancel — and
                canceling never removes their access to your chat.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={trial}
              onClick={() => setTrial((v) => !v)}
              className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${
                trial ? "bg-accent" : "bg-line"
              }`}
            >
              <span
                className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${
                  trial ? "left-[calc(100%-1.625rem)]" : "left-0.5"
                }`}
              />
            </button>
          </div>

          {trial && (
            <div className="space-y-1.5 fade-up">
              <p className="text-sm font-semibold">Trial length</p>
              <div className="flex items-center bg-card2 border border-line rounded-xl focus-within:border-accent transition-colors">
                <input
                  type="number"
                  min={1}
                  max={365}
                  inputMode="numeric"
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent py-3 pl-4 text-[15px] outline-none"
                />
                <span className="pr-4 text-muted text-sm select-none">days</span>
              </div>
              {!trialValid && (
                <p className="text-xs text-red-400">Enter 1 to 365 days.</p>
              )}
            </div>
          )}

          <div className="rounded-xl bg-card2 border border-line px-3.5 py-3 text-xs text-muted">
            <span className="text-fg font-semibold">What fans see: </span>
            {priceValid
              ? trial && trialValid
                ? `${days} ${days === 1 ? "day" : "days"} free trial · then ${subDollars(priceCents)} / month · Cancel anytime`
                : `${subDollars(priceCents)} / month · Cancel anytime`
              : "—"}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-card p-4 text-xs text-muted space-y-1">
        <p className="text-fg font-semibold text-sm">Good to know</p>
        <p>
          A fan who already verified a card with any creator on Lolyfans skips
          the card step everywhere — their saved card is reused, so your chat
          is instantly open to them and one-tap purchases work from the first
          message.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={save}
        disabled={saving || !priceValid || !trialValid}
        className="w-full sm:w-auto px-6 py-3 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-40"
      >
        {saving ? "Saving…" : saved ? "Saved!" : "Save"}
      </button>

      <CardCleanup />
    </div>
  );
}

type CleanupTotals = { checked: number; cleared: number; subscriptionsClosed: number };

/**
 * Removes saved cards that live in a previous Stripe account: they can't be
 * charged from the connected one, yet still count as "verified". Pages
 * through every chat so large fan bases finish within serverless limits.
 */
function CardCleanup() {
  const [running, setRunning] = useState(false);
  const [totals, setTotals] = useState<CleanupTotals | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (running) return;
    setRunning(true);
    setDone(false);
    setError("");
    const sum: CleanupTotals = { checked: 0, cleared: 0, subscriptionsClosed: 0 };
    setTotals({ ...sum });
    let cursor: string | null = null;
    try {
      do {
        const res: Response = await fetch("/api/payments/cards/cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursor }),
        });
        const data: Partial<CleanupTotals> & { nextCursor?: string | null; error?: string } =
          await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Cleanup failed");
        sum.checked += data.checked ?? 0;
        sum.cleared += data.cleared ?? 0;
        sum.subscriptionsClosed += data.subscriptionsClosed ?? 0;
        setTotals({ ...sum });
        cursor = data.nextCursor ?? null;
      } while (cursor);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cleanup failed");
    }
    setRunning(false);
  }

  return (
    <div className="rounded-2xl border border-line bg-card p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold">Saved cards</p>
        <p className="text-xs text-muted">
          Cards saved under a previous Stripe account can&apos;t be charged
          from the one connected now. This checks every fan&apos;s saved card
          against your current Stripe account and removes the ones that
          aren&apos;t there, so those fans are asked for a card again on their
          next purchase. Cards in the current account are kept.
        </p>
      </div>

      {totals && (
        <div className="rounded-xl bg-card2 border border-line px-3.5 py-3 text-xs space-y-1">
          <div className="flex justify-between gap-3">
            <span className="text-muted">Fans checked</span>
            <span className="font-semibold">{totals.checked}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted">Stale cards removed</span>
            <span className="font-semibold">{totals.cleared}</span>
          </div>
          {totals.subscriptionsClosed > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-muted">Old-account subscriptions closed</span>
              <span className="font-semibold">{totals.subscriptionsClosed}</span>
            </div>
          )}
          {done && (
            <p className="text-accent font-semibold pt-1">
              Done — only cards from your current Stripe account remain.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="button"
        onClick={() => void run()}
        disabled={running}
        className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-line2 bg-card2 text-sm font-semibold hover:bg-card transition-colors disabled:opacity-50"
      >
        {running ? (
          <span className="inline-flex items-center gap-2">
            <span className="w-4 h-4 rounded-full border-2 border-line border-t-accent animate-spin" />
            Checking cards…
          </span>
        ) : done ? (
          "Run again"
        ) : (
          "Clean up saved cards"
        )}
      </button>
    </div>
  );
}
