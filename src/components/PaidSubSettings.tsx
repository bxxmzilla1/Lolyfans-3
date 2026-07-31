"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { paidSubPriceLabel } from "@/lib/paidSub";

/**
 * PaidSub tab: a button in your chat input pushes a popup into that fan's
 * chat — one-time payment for unlimited messaging. The popup blurs and
 * blocks the whole chat; the only way through is the Stripe card input.
 */
export default function PaidSubSettings() {
  const [enabled, setEnabled] = useState(false);
  const [price, setPrice] = useState("5.00");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = data.user?.user_metadata ?? {};
        setEnabled(meta.paidsub_enabled === true);
        const cents = Math.round(Number(meta.paidsub_price_cents)) || 0;
        if (cents > 0) setPrice((cents / 100).toFixed(2).replace(/\.00$/, ""));
      });
  }, []);

  const priceCents = Math.round((parseFloat(price) || 0) * 100);

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    try {
      await supabaseBrowser().auth.updateUser({
        data: {
          paidsub_enabled: enabled && priceCents > 0,
          paidsub_price_cents: priceCents,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <p className="font-semibold">PaidSub</p>
        <p className="text-xs text-muted mt-1 leading-relaxed">
          Adds a button to your chat input. Tapping it sends that fan a popup:
          one-time payment of the price below for unlimited messaging. The
          popup blurs the whole chat and can&apos;t be scrolled or closed —
          the only way through is Pay Now, which opens the Stripe card input
          right there. Once they pay, that chat is never charged per message
          again.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl bg-card2 border border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Enable PaidSub</p>
          <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
            Shows the offer button in your chat input.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((v) => !v)}
          className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
            enabled ? "bg-accent" : "bg-line"
          }`}
          aria-label="Toggle PaidSub"
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <label className="block">
        <span className="text-sm font-semibold">One-time price</span>
        <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-card2 border border-line px-3 py-2.5 focus-within:border-accent">
          <span className="text-sm text-muted">$</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            placeholder="5.00"
            className="flex-1 bg-transparent text-sm"
          />
        </div>
        <span className="text-[11px] text-muted">
          What the fan pays once for unlimited messaging.
        </span>
      </label>

      {/* Preview of the popup the fan sees */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Popup preview
        </p>
        <div
          className="relative overflow-hidden rounded-[1.75rem] border border-blue-200 px-5 py-7 text-center space-y-3 shadow-lg"
          style={{
            background:
              "linear-gradient(160deg, #ffffff 0%, #eff6ff 45%, #dbeafe 100%)",
          }}
        >
          <p className="relative text-lg font-extrabold tracking-tight ig-gradient-text select-none">
            LolyFans
          </p>
          <p className="relative text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-600">
            Your free trial has ended
          </p>
          <p className="relative text-4xl font-extrabold leading-none text-blue-950">
            {paidSubPriceLabel(priceCents || 500)}
            <span className="ml-2 text-xl font-bold text-blue-500">ONCE</span>
          </p>
          <p className="relative text-xs text-slate-600">
            One-time payment of {paidSubPriceLabel(priceCents || 500)} for
            unlimited messaging
          </p>
          <span className="relative inline-block bg-blue-600 text-white text-xs font-bold rounded-xl px-6 py-2.5">
            Pay Now
          </span>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving || (enabled && priceCents <= 0)}
        className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {saved ? "Saved!" : saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
