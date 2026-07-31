"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Pay per Message tab: every message a fan sends costs a set price. Each fan
 * gets a free credit on their balance automatically; messages spend that
 * first. After it runs out they must verify a card. Further costs accrue and
 * are charged to their card about once an hour.
 */
export default function PayPerMessageSettings() {
  const [enabled, setEnabled] = useState(false);
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
        const cents = Math.round(Number(meta.ppm_price_cents)) || 0;
        if (cents > 0) setPrice((cents / 100).toFixed(2).replace(/\.00$/, ""));
        if (meta.ppm_free_credit_cents != null && meta.ppm_free_credit_cents !== "") {
          const credit = Math.round(Number(meta.ppm_free_credit_cents)) || 0;
          setFreeCredit((credit / 100).toFixed(2).replace(/\.00$/, ""));
        } else {
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
          ppm_show_popup: false,
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
          automatically. Messages spend that credit first; after it runs out,
          fans without a verified card lose the chat input until they add one.
          Further costs stack on their balance and are charged to their card
          automatically about once an hour — never per message.
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
            Free money added to each fan&apos;s balance automatically when they
            start chatting. Messages spend this first.
          </span>
        </label>
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
