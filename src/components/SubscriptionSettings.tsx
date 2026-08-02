"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { normalizeTelegramLink } from "@/lib/subscriptionPlan";

/**
 * Settings → Subscriptions: the profile gates a private Telegram channel
 * behind a DAILY Stripe subscription. The creator sets the daily price, can
 * switch on a 1-day free trial (Stripe charges automatically when the trial
 * ends), and pastes the private channel invite link fans are sent to after
 * paying.
 */
export default function SubscriptionSettings() {
  const [paid, setPaid] = useState(false);
  const [price, setPrice] = useState("");
  const [trialOn, setTrialOn] = useState(false);
  const [telegramLink, setTelegramLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
        setTrialOn(Math.floor(Number(meta.sub_trial_days) || 0) > 0);
        setTelegramLink(String(meta.sub_telegram_link ?? ""));
      });
  }, []);

  const priceCents = paid ? Math.round(parseFloat(price) * 100) || 0 : 0;
  const priceInvalid = paid && priceCents < 100;
  const linkTrimmed = telegramLink.trim();
  const linkInvalid = !!linkTrimmed && !normalizeTelegramLink(linkTrimmed);
  const priceLabel = `$${(priceCents / 100).toFixed(2).replace(/\.00$/, "")}`;

  async function save() {
    if (priceInvalid || linkInvalid) return;
    setSaving(true);
    try {
      await supabaseBrowser().auth.updateUser({
        data: {
          sub_price_cents: priceCents,
          // Telegram-channel subscriptions bill daily.
          sub_interval: "day",
          sub_trial_days: paid && trialOn ? 1 : 0,
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
          Fans pay a daily Stripe subscription to join your private Telegram
          channel. After they pay they&apos;re sent straight to your private
          invite link. Existing subscribers keep their current price.
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
            <label className="text-sm font-semibold">Daily price</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">$</span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder="4.99"
                className="flex-1 bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
              />
              <span className="text-sm text-muted">per day</span>
            </div>
            <p className="text-xs text-muted">
              Charged automatically by Stripe every day until the fan cancels.
            </p>
            {priceInvalid && (
              <p className="text-xs text-red-400">Minimum price is $1 per day</p>
            )}
          </div>

          <div className="rounded-xl border border-line bg-card2 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">1-day free trial</p>
                <p className="text-xs text-muted">
                  Fans join free for 1 day — after the trial ends, Stripe
                  charges the daily price automatically.
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
          </div>
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
        <div className="w-full px-5 py-3 rounded-full bg-accent text-white text-sm font-semibold flex items-center justify-between gap-3">
          <span>{paid ? "JOIN PRIVATE TELEGRAM CHANNEL" : "SUBSCRIBE"}</span>
          <span className="shrink-0">
            {!paid ? "FREE" : trialOn ? "1 day free trial" : `${priceLabel} / day`}
          </span>
        </div>
        {paid && trialOn && (
          <p className="text-xs text-muted text-center">
            Then {priceLabel} / day
          </p>
        )}
      </div>

      <button
        onClick={save}
        disabled={saving || priceInvalid || linkInvalid}
        className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {saved ? "Saved!" : saving ? "Saving…" : "Save subscription settings"}
      </button>
    </div>
  );
}
