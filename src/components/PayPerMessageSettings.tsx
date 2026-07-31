"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { formatPpmMoney } from "@/lib/payPerMessage";

/**
 * Pay per Message tab: every message a fan sends costs a set price. Each fan
 * gets a free credit (dollar amount) on their balance when they accept the
 * terms; messages spend that first. After it runs out they must verify a card.
 * Further costs accrue and are charged to their card about once an hour.
 */
export default function PayPerMessageSettings() {
  const [enabled, setEnabled] = useState(false);
  const [showPopup, setShowPopup] = useState(true);
  const [price, setPrice] = useState("0.50");
  const [freeCredit, setFreeCredit] = useState("5.00");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = data.user?.user_metadata ?? {};
        setEnabled(meta.ppm_enabled === true);
        setShowPopup(meta.ppm_show_popup !== false);
        const cents = Math.round(Number(meta.ppm_price_cents)) || 0;
        if (cents > 0) setPrice((cents / 100).toFixed(2).replace(/\.00$/, ""));
        if (meta.ppm_free_credit_cents != null && meta.ppm_free_credit_cents !== "") {
          const credit = Math.round(Number(meta.ppm_free_credit_cents)) || 0;
          setFreeCredit((credit / 100).toFixed(2).replace(/\.00$/, ""));
        } else {
          // Migrate old free-messages setting into a dollar credit preview.
          const freeMessages = Math.round(Number(meta.ppm_free_messages)) || 0;
          const migrated = freeMessages * (cents || 50);
          if (migrated > 0) {
            setFreeCredit((migrated / 100).toFixed(2).replace(/\.00$/, ""));
          }
        }
      });
  }, []);

  const priceCents = Math.max(
    0,
    Math.round(parseFloat(price.replace(/[^\d.]/g, "")) * 100) || 0
  );
  const freeCreditCents = Math.max(
    0,
    Math.round(parseFloat(freeCredit.replace(/[^\d.]/g, "")) * 100) || 0
  );

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await supabaseBrowser().auth.updateUser({
        data: {
          ppm_enabled: enabled && priceCents > 0,
          ppm_show_popup: showPopup,
          ppm_price_cents: priceCents,
          ppm_free_credit_cents: freeCreditCents,
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
        <p className="font-semibold">Pay per Message</p>
        <p className="text-xs text-muted mt-1 leading-relaxed">
          Every message a fan sends costs the price you set — for new and
          existing fans. Each fan gets the free credit below on their balance
          (via the optional popup, or silently if the popup is off). Messages
          spend that credit first; after it runs out, fans without a verified
          card lose the chat input until they add one. Further costs stack on
          their balance and are charged to their card automatically about once
          an hour — never per message.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl bg-card2 border border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Charge fans per message</p>
          <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
            When off, chatting stays free and nothing changes for fans.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((v) => !v)}
          className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
            enabled ? "bg-accent" : "bg-line"
          }`}
          aria-label="Toggle pay per message"
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl bg-card2 border border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Show terms popup</p>
          <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
            When off, fans never see the free-credit popup — credit is added
            to their balance automatically.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={showPopup}
          onClick={() => setShowPopup((v) => !v)}
          className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
            showPopup ? "bg-accent" : "bg-line"
          }`}
          aria-label="Toggle terms popup"
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              showPopup ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="text-sm font-semibold">Price per message</span>
          <div className="mt-1.5 flex items-center gap-2 bg-card2 border border-line rounded-xl px-3 py-2.5 focus-within:border-accent">
            <span className="text-muted text-sm">$</span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder="0.50"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
          </div>
          <span className="text-[11px] text-muted">
            What each fan message costs once their free credit is used up.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-semibold">Free credit per fan</span>
          <div className="mt-1.5 flex items-center gap-2 bg-card2 border border-line rounded-xl px-3 py-2.5 focus-within:border-accent">
            <span className="text-muted text-sm">$</span>
            <input
              value={freeCredit}
              onChange={(e) => setFreeCredit(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder="5.00"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
          </div>
          <span className="text-[11px] text-muted">
            Free money added to each fan&apos;s balance when they accept.
            Messages spend this first. Existing fans who haven&apos;t accepted
            yet get this amount too.
          </span>
        </label>
      </div>

      {/* Preview: the one-time popup fans must accept (when enabled) */}
      <div className={`space-y-2 ${showPopup ? "" : "opacity-45"}`}>
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Popup preview{showPopup ? "" : " · hidden"}
        </p>
        <div
          className="relative overflow-hidden rounded-[1.75rem] border border-black/10 px-5 py-7 text-center space-y-3 shadow-lg"
          style={{
            background:
              "linear-gradient(160deg, #ffffff 0%, #eff6ff 45%, #fdf2f8 100%)",
          }}
        >
          <div
            className="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full opacity-40 blur-2xl"
            style={{ background: "radial-gradient(circle, #fcd34d, transparent 70%)" }}
          />
          <div
            className="pointer-events-none absolute -bottom-14 -left-10 h-36 w-36 rounded-full opacity-35 blur-2xl"
            style={{ background: "radial-gradient(circle, #7dd3fc, transparent 70%)" }}
          />
          <p className="relative text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-600">
            Welcome gift
          </p>
          <p className="relative text-4xl font-extrabold leading-none text-slate-900">
            {formatPpmMoney(freeCreditCents)}
            <span className="ml-2 text-xl font-bold text-amber-500">FREE</span>
          </p>
          <p className="relative text-xs text-slate-600">
            Added to your balance to start chatting
          </p>
          <span className="relative inline-block bg-slate-900 text-white text-xs font-bold rounded-xl px-6 py-2.5">
            Accept &amp; start chatting
          </span>
          <p className="relative text-[11px] text-slate-500">
            {formatPpmMoney(priceCents)} per message after
          </p>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving || (enabled && priceCents <= 0)}
        className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {saved ? "Saved!" : saving ? "Saving…" : "Save"}
      </button>
      {enabled && priceCents <= 0 && (
        <p className="text-[11px] text-red-400 -mt-3">
          Set a price per message to turn this on.
        </p>
      )}
    </div>
  );
}
