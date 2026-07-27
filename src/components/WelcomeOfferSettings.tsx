"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { DEFAULT_WELCOME_OFFER, offerPriceLabel } from "@/lib/popupOffer";

/**
 * Welcome offer tab: the discounted token pack a fan sees as a popup right
 * after signing up and landing in the chat. The creator tunes the tokens,
 * the offered price and the struck-through "original" price.
 */
export default function WelcomeOfferSettings() {
  const [enabled, setEnabled] = useState(DEFAULT_WELCOME_OFFER.enabled);
  const [tokens, setTokens] = useState(String(DEFAULT_WELCOME_OFFER.tokens));
  const [price, setPrice] = useState(
    (DEFAULT_WELCOME_OFFER.priceCents / 100).toFixed(2)
  );
  const [original, setOriginal] = useState(
    (DEFAULT_WELCOME_OFFER.originalCents / 100).toFixed(2)
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = data.user?.user_metadata ?? {};
        setEnabled(meta.welcome_offer_enabled !== false);
        if (Number(meta.welcome_offer_tokens) > 0)
          setTokens(String(meta.welcome_offer_tokens));
        if (Number(meta.welcome_offer_price_cents) > 0)
          setPrice((Number(meta.welcome_offer_price_cents) / 100).toFixed(2));
        if (Number(meta.welcome_offer_original_cents) > 0)
          setOriginal((Number(meta.welcome_offer_original_cents) / 100).toFixed(2));
      });
  }, []);

  const tokensNum = Math.round(Number(tokens));
  const priceCents = Math.round(Number(price) * 100);
  const originalCents = Math.round(Number(original) * 100);
  const valid = tokensNum > 0 && priceCents > 0 && originalCents > 0;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await supabaseBrowser().auth.updateUser({
        data: {
          welcome_offer_enabled: enabled,
          welcome_offer_tokens: tokensNum,
          welcome_offer_price_cents: priceCents,
          welcome_offer_original_cents: originalCents,
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
        <p className="font-semibold">Welcome offer</p>
        <p className="text-xs text-muted mt-1 leading-relaxed">
          A popup new fans see once, right after signing up and landing in the
          chat. It welcomes them, explains that photos and videos unlock with
          Tokens, and offers this discounted starter pack. It only applies to
          their very first top-up.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl bg-card2 border border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Show the welcome offer</p>
          <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
            When off, new fans land in the chat without the popup.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((v) => !v)}
          className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
            enabled ? "bg-accent" : "bg-line"
          }`}
          aria-label="Toggle the welcome offer popup"
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted uppercase tracking-wide">
            Tokens they get
          </label>
          <input
            value={tokens}
            onChange={(e) => setTokens(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder="1300"
            className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted uppercase tracking-wide">
            Offer price ($)
          </label>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            placeholder="4.99"
            className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
          />
        </div>
        <div className="space-y-1.5 col-span-2">
          <label className="text-xs font-semibold text-muted uppercase tracking-wide">
            Original price shown ($)
          </label>
          <input
            value={original}
            onChange={(e) => setOriginal(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            placeholder="99.99"
            className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
          />
          <p className="text-[11px] text-muted">
            Displayed struck through, so fans see the discount.
          </p>
        </div>
      </div>

      {/* Live preview of what the fan sees after signing up */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Preview
        </p>
        <div
          className={`relative bg-card border border-accent/40 rounded-3xl p-6 text-center space-y-2.5 overflow-hidden ${
            enabled ? "" : "opacity-40"
          }`}
        >
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-36 rounded-full bg-accent/25 blur-3xl pointer-events-none" />
          <p className="relative text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
            Welcome offer
          </p>
          <p className="relative text-sm font-semibold">
            Welcome! So happy you&apos;re here 🎉
          </p>
          <p className="relative text-xs text-muted leading-relaxed">
            Quick heads up: photos and videos here unlock with Tokens. Start
            with a full wallet:
          </p>
          <p className="relative text-3xl font-extrabold tabular-nums leading-none">
            {(tokensNum > 0 ? tokensNum : 0).toLocaleString("en-US")}
            <span className="text-base font-semibold text-muted"> Tokens</span>
          </p>
          <p className="relative">
            <span className="text-2xl font-extrabold text-accent tabular-nums">
              {priceCents > 0 ? offerPriceLabel(priceCents) : "$0"}
            </span>{" "}
            <span className="text-sm font-semibold text-muted line-through tabular-nums">
              {originalCents > 0 ? offerPriceLabel(originalCents) : "$0"}
            </span>
          </p>
          <p className="relative text-[11px] text-muted">
            {enabled
              ? "Appears once, right after the fan signs up"
              : "Currently off — new fans won't see it"}
          </p>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving || !valid}
        className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {saved ? "Saved!" : saving ? "Saving…" : "Save welcome offer"}
      </button>
      <p className="text-[11px] text-muted -mt-3">
        Each fan sees the popup once, and the discount applies only to their
        very first top-up.
      </p>
    </div>
  );
}
