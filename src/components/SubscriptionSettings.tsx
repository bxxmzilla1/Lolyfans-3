"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  subCaption,
  subCtaLabel,
  subPlanFromMetadata,
  type SubInterval,
} from "@/lib/subscriptionPlan";

const INTERVALS: Array<{ value: SubInterval; label: string; hint: string }> = [
  { value: "day", label: "Daily", hint: "billed every day" },
  { value: "week", label: "Weekly", hint: "billed every week" },
  { value: "month", label: "Monthly", hint: "billed every month" },
  { value: "lifetime", label: "Lifetime", hint: "one-time payment" },
];

/**
 * Settings → Subscriptions: what fans pay to subscribe to the profile.
 * Free, or a daily/weekly/monthly price with an optional free trial and an
 * optional first-period percentage discount.
 */
export default function SubscriptionSettings() {
  const [paid, setPaid] = useState(false);
  const [price, setPrice] = useState("");
  const [interval, setInterval_] = useState<SubInterval>("month");
  const [trialOn, setTrialOn] = useState(false);
  const [trialDays, setTrialDays] = useState("7");
  const [discountOn, setDiscountOn] = useState(false);
  const [discountPct, setDiscountPct] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
        const plan = subPlanFromMetadata(meta);
        if (plan.priceCents > 0) {
          setPaid(true);
          setPrice((plan.priceCents / 100).toFixed(2).replace(/\.00$/, ""));
        }
        setInterval_(plan.interval);
        if (plan.trialDays > 0) {
          setTrialOn(true);
          setTrialDays(String(plan.trialDays));
        }
        if (plan.discountPct > 0) {
          setDiscountOn(true);
          setDiscountPct(String(plan.discountPct));
        }
      });
  }, []);

  const priceCents = paid ? Math.round(parseFloat(price) * 100) || 0 : 0;
  // Lifetime is a single payment — trials and first-period discounts don't apply.
  const recurring = interval !== "lifetime";
  const trial =
    paid && recurring && trialOn
      ? Math.min(365, Math.max(0, Math.floor(Number(trialDays) || 0)))
      : 0;
  const discount =
    paid && recurring && discountOn
      ? Math.min(95, Math.max(0, Math.floor(Number(discountPct) || 0)))
      : 0;
  const previewPlan = { priceCents, interval, trialDays: trial, discountPct: discount };
  const previewCaption = subCaption(previewPlan);
  const priceInvalid = paid && priceCents < 100;

  async function save() {
    if (priceInvalid) return;
    setSaving(true);
    try {
      await supabaseBrowser().auth.updateUser({
        data: {
          sub_price_cents: priceCents,
          sub_interval: interval,
          sub_trial_days: trial,
          sub_discount_pct: discount,
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
        <p className="text-sm font-semibold">Profile subscription</p>
        <p className="text-xs text-muted mt-0.5">
          What new fans pay to subscribe to your profile. Existing subscribers
          keep their current price.
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
            <label className="text-sm font-semibold">Price</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">$</span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder="9.99"
                className="flex-1 bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
              />
            </div>
            {priceInvalid && (
              <p className="text-xs text-red-400">Minimum price is $1</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold">Billing period</label>
            <div className="grid grid-cols-2 gap-2">
              {INTERVALS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setInterval_(opt.value)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    interval === opt.value
                      ? "bg-accent text-white border-accent"
                      : "bg-card2 border-line"
                  }`}
                >
                  <span className="block text-sm font-semibold">{opt.label}</span>
                  <span
                    className={`block text-[11px] ${
                      interval === opt.value ? "text-white/75" : "text-muted"
                    }`}
                  >
                    {opt.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {recurring && (
          <>
          <div className="rounded-xl border border-line bg-card2 px-3 py-2.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Free trial for new subscribers</p>
                <p className="text-xs text-muted">
                  They subscribe now, get charged after the trial ends.
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
                  onChange={(e) => setTrialDays(e.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  placeholder="7"
                  className="w-20 bg-bg border border-line rounded-xl px-3 py-2 text-sm focus:border-accent outline-none"
                />
                <span className="text-sm text-muted">days free before the first charge</span>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-line bg-card2 px-3 py-2.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">
                  First {interval === "month" ? "month" : interval} discount
                </p>
                <p className="text-xs text-muted">
                  Percentage off their first payment only.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDiscountOn((v) => !v)}
                aria-label={discountOn ? "Disable discount" : "Enable discount"}
                className="relative shrink-0 w-12 h-7 rounded-full bg-bg border border-line transition-colors"
              >
                <span
                  className={`absolute top-1 w-4.5 h-4.5 rounded-full transition-all ${
                    discountOn ? "left-6.5 bg-accent" : "left-1 bg-muted"
                  }`}
                />
              </button>
            </div>
            {discountOn && (
              <div className="flex items-center gap-2">
                <input
                  value={discountPct}
                  onChange={(e) => setDiscountPct(e.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  placeholder="50"
                  className="w-20 bg-bg border border-line rounded-xl px-3 py-2 text-sm focus:border-accent outline-none"
                />
                <span className="text-sm text-muted">% off the first payment (max 95%)</span>
              </div>
            )}
          </div>
          </>
          )}
        </>
      )}

      {/* Live preview of the fan-facing button */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Fans will see
        </p>
        <div className="w-full px-5 py-3 rounded-full bg-accent text-white text-sm font-semibold flex items-center justify-between">
          <span>SUBSCRIBE</span>
          <span>{subCtaLabel(previewPlan)}</span>
        </div>
        {previewCaption && (
          <p className="text-xs text-muted text-center">{previewCaption}</p>
        )}
      </div>

      <button
        onClick={save}
        disabled={saving || priceInvalid}
        className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {saved ? "Saved!" : saving ? "Saving…" : "Save subscription settings"}
      </button>
    </div>
  );
}
