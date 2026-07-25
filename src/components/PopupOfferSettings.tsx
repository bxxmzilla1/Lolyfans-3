"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { DEFAULT_POPUP_OFFER, offerPriceLabel } from "@/lib/popupOffer";

/**
 * Pop up Offers tab: the creator tunes the one-time first top-up offer —
 * tokens, price, the struck-through "original" price, and how many seconds
 * after their first locked media the popup appears.
 */
export default function PopupOfferSettings() {
  const [tokens, setTokens] = useState(String(DEFAULT_POPUP_OFFER.tokens));
  const [price, setPrice] = useState(
    (DEFAULT_POPUP_OFFER.priceCents / 100).toFixed(2)
  );
  const [original, setOriginal] = useState(
    (DEFAULT_POPUP_OFFER.originalCents / 100).toFixed(2)
  );
  const [delay, setDelay] = useState(String(DEFAULT_POPUP_OFFER.delaySeconds));
  const [popupEnabled, setPopupEnabled] = useState(DEFAULT_POPUP_OFFER.popupEnabled);
  const [packEnabled, setPackEnabled] = useState(DEFAULT_POPUP_OFFER.packEnabled);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = data.user?.user_metadata ?? {};
        if (Number(meta.offer_tokens) > 0) setTokens(String(meta.offer_tokens));
        if (Number(meta.offer_price_cents) > 0)
          setPrice((Number(meta.offer_price_cents) / 100).toFixed(2));
        if (Number(meta.offer_original_cents) > 0)
          setOriginal((Number(meta.offer_original_cents) / 100).toFixed(2));
        if (Number(meta.offer_delay_seconds) > 0)
          setDelay(String(meta.offer_delay_seconds));
        setPopupEnabled(meta.offer_popup_enabled !== false);
        setPackEnabled(meta.offer_pack_enabled !== false);
      });
  }, []);

  const tokensNum = Math.round(Number(tokens));
  const priceCents = Math.round(Number(price) * 100);
  const originalCents = Math.round(Number(original) * 100);
  const delayNum = Math.round(Number(delay));
  const valid =
    tokensNum > 0 && priceCents > 0 && originalCents > 0 && delayNum > 0;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await supabaseBrowser().auth.updateUser({
        data: {
          offer_tokens: tokensNum,
          offer_price_cents: priceCents,
          offer_original_cents: originalCents,
          offer_delay_seconds: delayNum,
          offer_popup_enabled: popupEnabled,
          offer_pack_enabled: packEnabled,
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
        <p className="font-semibold">One-time top-up offer</p>
        <p className="text-xs text-muted mt-1 leading-relaxed">
          Fans who have never topped up see this offer highlighted in their
          wallet, and as a popup after you send them locked content for the
          first time. Their first purchase also saves their card, so every
          top-up after that is one tap.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl bg-card2 border border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Show in token packs</p>
          <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
            Highlight the discounted offer in the fan&apos;s token pack list.
            When off, the packs show their normal prices.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={packEnabled}
          onClick={() => setPackEnabled((v) => !v)}
          className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
            packEnabled ? "bg-accent" : "bg-line"
          }`}
          aria-label="Toggle the offer in the token pack list"
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              packEnabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl bg-card2 border border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Automatic popup</p>
          <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
            Show the offer as a popup after the fan receives their first locked
            content. When off, the offer only appears highlighted in their
            wallet.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={popupEnabled}
          onClick={() => setPopupEnabled((v) => !v)}
          className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
            popupEnabled ? "bg-accent" : "bg-line"
          }`}
          aria-label="Toggle automatic offer popup"
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              popupEnabled ? "translate-x-[22px]" : "translate-x-0.5"
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
        <div className="space-y-1.5">
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
        <div className={`space-y-1.5 ${popupEnabled ? "" : "opacity-40"}`}>
          <label className="text-xs font-semibold text-muted uppercase tracking-wide">
            Popup delay (seconds)
          </label>
          <input
            value={delay}
            onChange={(e) => setDelay(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder="7"
            className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
          />
          <p className="text-[11px] text-muted">
            After your first locked photo/video reaches the fan.
          </p>
        </div>
      </div>

      {/* Live preview of what the fan's popup will show */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Preview
        </p>
        <div className="relative bg-card border border-accent/40 rounded-3xl p-6 text-center space-y-2 overflow-hidden">
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-36 rounded-full bg-accent/25 blur-3xl pointer-events-none" />
          <p className="relative text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
            One-time offer
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
            {popupEnabled
              ? `Appears ${delayNum > 0 ? delayNum : 0}s after your first locked media`
              : "Popup off — shown only in the fan's wallet"}
          </p>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving || !valid}
        className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {saved ? "Saved!" : saving ? "Saving…" : "Save offer"}
      </button>
      <p className="text-[11px] text-muted -mt-3">
        The offer applies once per fan — only on their very first top-up.
      </p>
    </div>
  );
}
