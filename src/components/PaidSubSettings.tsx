"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { DEFAULT_PAID_SUB, paidSubPriceLabel } from "@/lib/paidSub";

/**
 * PaidSub tab: a button in your chat input pushes a popup into that fan's
 * chat — their first Token top-up at a discount, which also unlocks
 * unlimited messaging. The popup blurs and blocks the whole chat; the only
 * way through is Pay Now.
 */
export default function PaidSubSettings() {
  const [enabled, setEnabled] = useState(false);
  const [tokens, setTokens] = useState(String(DEFAULT_PAID_SUB.tokens));
  const [price, setPrice] = useState("4.99");
  const [original, setOriginal] = useState("9.99");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = data.user?.user_metadata ?? {};
        setEnabled(meta.paidsub_enabled === true);
        const t = Math.round(Number(meta.paidsub_tokens)) || 0;
        if (t > 0) setTokens(String(t));
        const cents = Math.round(Number(meta.paidsub_price_cents)) || 0;
        if (cents > 0) setPrice((cents / 100).toFixed(2).replace(/\.00$/, ""));
        const orig = Math.round(Number(meta.paidsub_original_cents)) || 0;
        if (orig > 0) setOriginal((orig / 100).toFixed(2).replace(/\.00$/, ""));
      });
  }, []);

  const tokenN = Math.max(0, Math.round(parseInt(tokens, 10) || 0));
  const priceCents = Math.round((parseFloat(price) || 0) * 100);
  const originalCents = Math.round((parseFloat(original) || 0) * 100);
  const valid =
    tokenN > 0 && priceCents > 0 && originalCents >= priceCents;

  async function save() {
    if (saving) return;
    if (enabled && !valid) return;
    setSaving(true);
    setSaved(false);
    try {
      await supabaseBrowser().auth.updateUser({
        data: {
          paidsub_enabled: enabled && valid,
          paidsub_tokens: tokenN,
          paidsub_price_cents: priceCents,
          paidsub_original_cents: originalCents,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  const previewTokens = tokenN || DEFAULT_PAID_SUB.tokens;
  const previewPrice = priceCents || DEFAULT_PAID_SUB.priceCents;
  const previewOriginal = originalCents || DEFAULT_PAID_SUB.originalCents;

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <p className="font-semibold">PaidSub</p>
        <p className="text-xs text-muted mt-1 leading-relaxed">
          Adds a button to your chat input. Tapping it sends that fan a popup
          for their <b>first Token top-up</b> at a discount — paying also
          unlocks <b>unlimited messaging</b> (no more Pay per Message charges).
          The popup blurs the whole chat and can&apos;t be closed — Pay Now
          opens the Stripe card input right there.
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
        <span className="text-sm font-semibold">Token amount</span>
        <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-card2 border border-line px-3 py-2.5 focus-within:border-accent">
          <input
            value={tokens}
            onChange={(e) => setTokens(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder="1300"
            className="flex-1 bg-transparent text-sm"
          />
          <span className="text-sm text-muted">Tokens</span>
        </div>
        <span className="text-[11px] text-muted">
          Credited to the fan&apos;s wallet when they pay (their first top-up).
        </span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-semibold">Discounted price</span>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-card2 border border-line px-3 py-2.5 focus-within:border-accent">
            <span className="text-sm text-muted">$</span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder="4.99"
              className="flex-1 bg-transparent text-sm"
            />
          </div>
        </label>
        <label className="block">
          <span className="text-sm font-semibold">Original price</span>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-card2 border border-line px-3 py-2.5 focus-within:border-accent">
            <span className="text-sm text-muted">$</span>
            <input
              value={original}
              onChange={(e) => setOriginal(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder="9.99"
              className="flex-1 bg-transparent text-sm"
            />
          </div>
        </label>
      </div>
      <p className="text-[11px] text-muted -mt-3">
        Discounted is what they pay; original shows struck-through next to it.
      </p>

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
          <p className="relative text-4xl font-extrabold leading-none text-blue-950 tabular-nums">
            {previewTokens.toLocaleString("en-US")}
            <span className="ml-2 text-xl font-bold text-blue-500">Tokens</span>
          </p>
          <p className="relative flex items-baseline justify-center gap-2">
            <span className="text-2xl font-extrabold text-blue-600">
              {paidSubPriceLabel(previewPrice)}
            </span>
            <span className="text-sm text-slate-400 line-through">
              {paidSubPriceLabel(previewOriginal)}
            </span>
          </p>
          <p className="relative text-xs text-slate-600">
            First top-up · unlocks unlimited messaging
          </p>
          <span className="relative inline-block bg-blue-600 text-white text-xs font-bold rounded-xl px-6 py-2.5">
            Pay Now
          </span>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving || (enabled && !valid)}
        className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {saved ? "Saved!" : saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
