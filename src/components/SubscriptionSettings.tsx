"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { normalizeTelegramLink } from "@/lib/subscriptionPlan";

/**
 * Creator settings: private Telegram channel invite link only.
 * Channel access is free — no subscription pricing.
 */
export default function SubscriptionSettings() {
  const [telegramLink, setTelegramLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
        setTelegramLink(String(meta.sub_telegram_link ?? ""));
        // Clear any leftover paid-plan pricing so join stays free.
        if (Number(meta.sub_price_cents) > 0) {
          void supabaseBrowser().auth.updateUser({
            data: { sub_price_cents: 0, sub_trial_days: 0, sub_discount_pct: 0 },
          });
        }
      });
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    const link = normalizeTelegramLink(telegramLink.trim());
    const { error: err } = await supabaseBrowser().auth.updateUser({
      data: {
        sub_telegram_link: link,
        sub_price_cents: 0,
        sub_trial_days: 0,
        sub_discount_pct: 0,
      },
    });
    setSaving(false);
    if (err) {
      setError(err.message || "Could not save");
      return;
    }
    setTelegramLink(link);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <p className="text-sm font-semibold">Private Telegram channel</p>
        <p className="text-xs text-muted mt-0.5">
          Fans who sign up through your invite link are sent here for free.
          Paste a private invite link (t.me/+… or t.me/joinchat/…).
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold">Channel invite link</label>
        <input
          value={telegramLink}
          onChange={(e) => setTelegramLink(e.target.value)}
          placeholder="https://t.me/+AbCdEfGhIjK"
          className="w-full bg-card2 border border-line rounded-xl px-4 py-3 text-sm placeholder:text-muted focus:border-accent outline-none"
        />
        <p className="text-[11px] text-muted">
          Use a private invite link from Telegram → your channel → Invite links.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-card2 px-4 py-4 space-y-2">
        <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">
          Fan-facing button
        </p>
        <div className="w-full px-5 py-3 rounded-full bg-accent text-white text-sm font-semibold text-center">
          JOIN PRIVATE TELEGRAM CHANNEL
        </div>
        <p className="text-xs text-muted text-center">Free to join</p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="w-full bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-50"
      >
        {saving ? "Saving…" : saved ? "Saved" : "Save"}
      </button>
    </div>
  );
}
