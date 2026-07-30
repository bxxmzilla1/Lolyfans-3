"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Pay per Message tab: every message a fan sends costs a set price, for new
 * and existing fans alike. Each fan gets a free-message allowance first;
 * once it's spent they must verify a card to keep chatting. Costs accrue on
 * a balance shown in the fan's wallet badge and are auto-charged to their
 * card roughly once an hour.
 */
export default function PayPerMessageSettings() {
  const [enabled, setEnabled] = useState(false);
  const [price, setPrice] = useState("0.50");
  const [freeMessages, setFreeMessages] = useState("10");
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
        const free = Math.round(Number(meta.ppm_free_messages));
        if (Number.isFinite(free) && free >= 0) setFreeMessages(String(free));
      });
  }, []);

  const priceCents = Math.max(0, Math.round(parseFloat(price.replace(/[^\d.]/g, "")) * 100) || 0);
  const freeN = Math.max(0, Math.round(parseInt(freeMessages, 10)) || 0);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await supabaseBrowser().auth.updateUser({
        data: {
          ppm_enabled: enabled && priceCents > 0,
          ppm_price_cents: priceCents,
          ppm_free_messages: freeN,
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
          existing fans. Each fan first gets the free messages below; a
          one-time popup (no way to close it without accepting) shows them the
          free amount and the price, and you&apos;ll see a checkmark next to
          fans who accepted. After the free messages run out, fans without a
          verified card lose the chat input until they add one. Costs stack on
          a balance in their wallet and are charged to their card automatically
          about once an hour — never per message.
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
            What each fan message costs once their free messages are used up.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-semibold">Free messages per fan</span>
          <input
            value={freeMessages}
            onChange={(e) => setFreeMessages(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder="10"
            className="mt-1.5 w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
          />
          <span className="text-[11px] text-muted">
            How many messages each fan can send before billing starts. Existing
            fans get this allowance from now on too.
          </span>
        </label>
      </div>

      {/* Preview: the one-time popup fans must accept */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Popup preview
        </p>
        <div className="rounded-3xl border border-line bg-card2 px-5 py-6 text-center space-y-2">
          <p className="text-3xl font-extrabold leading-tight">
            {freeN} FREE message{freeN === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-muted">
            Then ${(priceCents / 100).toFixed(2)} per message, billed to your card
          </p>
          <span className="inline-block mt-2 bg-accent text-white text-xs font-semibold rounded-xl px-6 py-2.5">
            Accept &amp; start chatting
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
      {enabled && priceCents <= 0 && (
        <p className="text-[11px] text-red-400 -mt-3">
          Set a price per message to turn this on.
        </p>
      )}
    </div>
  );
}
