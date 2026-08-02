"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { normalizeTelegramLink } from "@/lib/subscriptionPlan";
import ConfirmDialog from "./ConfirmDialog";

type Billing = "day" | "month" | "lifetime";

const BILLING_OPTIONS: { id: Billing; label: string }[] = [
  { id: "day", label: "Daily" },
  { id: "month", label: "Monthly" },
  { id: "lifetime", label: "One-time" },
];

const BILLING_NOUN: Record<Billing, string> = {
  day: "day",
  month: "month",
  lifetime: "one-time",
};

const BILLING_ADJECTIVE: Record<Billing, string> = {
  day: "daily",
  month: "monthly",
  lifetime: "one-time",
};

/**
 * Settings → Subscriptions: the profile gates a private Telegram channel
 * behind a Stripe charge — a daily or monthly subscription, or a single
 * one-time payment for lifetime access. Recurring plans can add a free trial
 * of any length (Stripe charges automatically when the trial ends). The
 * creator also pastes the private channel invite link fans are sent to after
 * paying.
 */
export default function SubscriptionSettings() {
  const [paid, setPaid] = useState(false);
  const [price, setPrice] = useState("");
  const [billing, setBilling] = useState<Billing>("day");
  const [trialOn, setTrialOn] = useState(false);
  const [trialDays, setTrialDays] = useState("1");
  const [telegramLink, setTelegramLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Mass-unsubscribe of free followers (paid subscribers are never touched).
  const [freeCount, setFreeCount] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeResult, setRemoveResult] = useState("");

  useEffect(() => {
    fetch("/api/chats/free-subscribers")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.count === "number") setFreeCount(data.count);
      })
      .catch(() => {});
  }, []);

  async function removeFreeSubscribers() {
    setConfirmRemove(false);
    if (removing) return;
    setRemoving(true);
    setRemoveResult("");
    try {
      const res = await fetch("/api/chats/free-subscribers", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFreeCount(0);
        setRemoveResult(
          `Removed ${data.removed ?? 0} free subscriber${
            data.removed === 1 ? "" : "s"
          }.`
        );
      } else {
        setRemoveResult(data.error || "Could not remove free subscribers");
      }
    } catch {
      setRemoveResult("Could not remove free subscribers");
    }
    setRemoving(false);
  }

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
        const priceCents = Math.max(0, Math.round(Number(meta.sub_price_cents) || 0));
        if (priceCents > 0) {
          setPaid(true);
          setPrice((priceCents / 100).toFixed(2).replace(/\.00$/, ""));
        }
        const rawInterval = meta.sub_interval;
        setBilling(
          rawInterval === "month" || rawInterval === "lifetime"
            ? rawInterval
            : "day"
        );
        const savedTrialDays = Math.floor(Number(meta.sub_trial_days) || 0);
        setTrialOn(savedTrialDays > 0);
        if (savedTrialDays > 0) setTrialDays(String(savedTrialDays));
        setTelegramLink(String(meta.sub_telegram_link ?? ""));
      });
  }, []);

  const priceCents = paid ? Math.round(parseFloat(price) * 100) || 0 : 0;
  const priceInvalid = paid && priceCents < 100;
  const linkTrimmed = telegramLink.trim();
  const linkInvalid = !!linkTrimmed && !normalizeTelegramLink(linkTrimmed);
  const priceLabel = `$${(priceCents / 100).toFixed(2).replace(/\.00$/, "")}`;

  const recurring = billing !== "lifetime";
  // Stripe caps trial_period_days at 730; we keep a saner 365 ceiling.
  const trialDaysNum = Math.floor(Number(trialDays)) || 0;
  const trialActive = paid && recurring && trialOn;
  const trialInvalid = trialActive && (trialDaysNum < 1 || trialDaysNum > 365);

  async function save() {
    if (priceInvalid || linkInvalid || trialInvalid) return;
    setSaving(true);
    try {
      await supabaseBrowser().auth.updateUser({
        data: {
          sub_price_cents: priceCents,
          sub_interval: billing,
          // Trials only make sense on recurring billing.
          sub_trial_days: trialActive ? trialDaysNum : 0,
          sub_discount_pct: 0,
          sub_telegram_link: normalizeTelegramLink(linkTrimmed),
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <p className="text-sm font-semibold">Private Telegram channel subscription</p>
        <p className="text-xs text-muted mt-0.5">
          Fans pay through Stripe — a daily or monthly subscription, or a
          single one-time payment — to join your private Telegram channel.
          After they pay they&apos;re sent straight to your private invite
          link. Existing subscribers keep their current price.
        </p>
      </div>

      {/* Free vs paid */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setPaid(false)}
          className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${
            !paid ? "bg-accent text-white border-accent" : "bg-card2 border-line"
          }`}
        >
          Free
        </button>
        <button
          type="button"
          onClick={() => setPaid(true)}
          className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${
            paid ? "bg-accent text-white border-accent" : "bg-card2 border-line"
          }`}
        >
          Paid
        </button>
      </div>

      {paid && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-semibold">Billing</label>
            <div className="grid grid-cols-3 gap-2">
              {BILLING_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setBilling(opt.id)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${
                    billing === opt.id
                      ? "bg-accent text-white border-accent"
                      : "bg-card2 border-line"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">
              {billing === "lifetime"
                ? "Fans pay once and keep access forever."
                : `Fans are charged automatically by Stripe every ${BILLING_NOUN[billing]} until they cancel.`}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold">
              {billing === "day"
                ? "Daily price"
                : billing === "month"
                  ? "Monthly price"
                  : "One-time price"}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">$</span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder="4.99"
                className="flex-1 bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
              />
              <span className="text-sm text-muted">
                {billing === "lifetime" ? "one-time" : `per ${BILLING_NOUN[billing]}`}
              </span>
            </div>
            {priceInvalid && (
              <p className="text-xs text-red-400">Minimum price is $1</p>
            )}
          </div>

          {recurring && (
            <div className="rounded-xl border border-line bg-card2 px-3 py-2.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Free trial</p>
                  <p className="text-xs text-muted">
                    Fans join free — after the trial ends, Stripe charges the{" "}
                    {BILLING_ADJECTIVE[billing]} price automatically.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTrialOn((v) => !v)}
                  aria-label={trialOn ? "Disable free trial" : "Enable free trial"}
                  className="relative shrink-0 w-12 h-7 rounded-full bg-bg border border-line transition-colors"
                >
                  <span
                    className={`absolute top-1 w-4.5 h-4.5 rounded-full transition-all ${
                      trialOn ? "left-6.5 bg-accent" : "left-1 bg-muted"
                    }`}
                  />
                </button>
              </div>
              {trialOn && (
                <div className="flex items-center gap-2">
                  <input
                    value={trialDays}
                    onChange={(e) =>
                      setTrialDays(e.target.value.replace(/\D/g, "").slice(0, 3))
                    }
                    inputMode="numeric"
                    placeholder="1"
                    className="w-20 bg-card border border-line rounded-xl px-3 py-2.5 text-sm text-center placeholder:text-muted focus:border-accent outline-none"
                  />
                  <span className="text-sm text-muted">
                    day{trialDaysNum === 1 ? "" : "s"} free
                  </span>
                </div>
              )}
              {trialInvalid && (
                <p className="text-xs text-red-400">
                  Trial must be between 1 and 365 days
                </p>
              )}
            </div>
          )}
        </>
      )}

      <div className="space-y-2">
        <label className="text-sm font-semibold">Private Telegram channel link</label>
        <input
          value={telegramLink}
          onChange={(e) => setTelegramLink(e.target.value)}
          placeholder="https://t.me/+AbCdEfGh1234"
          className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
        />
        <p className="text-xs text-muted">
          Your channel&apos;s private invite link (Telegram → channel → Manage
          → Invite links). Subscribers are redirected here right after their
          payment — the link is never shown to anyone who hasn&apos;t paid.
        </p>
        {linkInvalid && (
          <p className="text-xs text-red-400">
            That doesn&apos;t look like a Telegram link — it should start with
            t.me or telegram.me
          </p>
        )}
      </div>

      {/* Live preview of the fan-facing button */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Fans will see
        </p>
        <div className="w-full px-5 py-3 rounded-full bg-accent text-white text-sm font-semibold text-center">
          {paid ? "JOIN PRIVATE TELEGRAM CHANNEL" : "SUBSCRIBE"}
        </div>
        {paid && (
          <p className="text-xs text-muted text-center">
            {billing === "lifetime"
              ? "One-time payment · lifetime access"
              : `${
                  trialOn
                    ? `${trialDaysNum || 1} day${
                        (trialDaysNum || 1) === 1 ? "" : "s"
                      } free trial · then ${priceLabel} / ${billing}`
                    : `${priceLabel} / ${billing}`
                } · Cancel anytime`}
          </p>
        )}
      </div>

      <button
        onClick={save}
        disabled={saving || priceInvalid || linkInvalid || trialInvalid}
        className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {saved ? "Saved!" : saving ? "Saving…" : "Save subscription settings"}
      </button>

      {/* Mass-unsubscribe free followers — paid subscribers always stay. */}
      <div className="rounded-xl border border-line bg-card2 px-3.5 py-3 space-y-2.5">
        <div>
          <p className="text-sm font-semibold">Free subscribers</p>
          <p className="text-xs text-muted mt-0.5">
            {freeCount === null
              ? "Fans who subscribed while the profile was free."
              : `${freeCount.toLocaleString("en-US")} fan${
                  freeCount === 1 ? "" : "s"
                } subscribed for free. Removing them unsubscribes them from your profile — paying subscribers are never touched.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmRemove(true)}
          disabled={removing || freeCount === 0}
          className="w-full bg-card border border-line text-red-400 hover:text-red-500 font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 transition-colors"
        >
          {removing ? "Removing…" : "Remove all free subscribers"}
        </button>
        {removeResult && (
          <p className="text-xs text-muted text-center">{removeResult}</p>
        )}
      </div>

      {confirmRemove && (
        <ConfirmDialog
          title="Remove all free subscribers"
          message={`Unsubscribe ${
            freeCount === null ? "all" : freeCount.toLocaleString("en-US")
          } free subscriber${
            freeCount === 1 ? "" : "s"
          } from your profile? Paying subscribers keep their subscription. This can't be undone — they'd have to subscribe again themselves.`}
          confirmLabel="Remove"
          onConfirm={removeFreeSubscribers}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  );
}
