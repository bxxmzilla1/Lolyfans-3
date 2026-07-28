"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { IconEye } from "./Icons";

/**
 * Card Verify tab: while a fan has no card on file, every photo/video the
 * creator sends renders blurred with a "Verify to view" button that opens
 * the embedded Stripe card inputs (SetupIntent — no charge). Everything
 * unlocks the moment they verify.
 */
export default function VerifyPopupSettings() {
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = data.user?.user_metadata ?? {};
        setEnabled(meta.verify_popup_enabled !== false);
      });
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await supabaseBrowser().auth.updateUser({
        data: { verify_popup_enabled: enabled },
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
        <p className="font-semibold">Card verification</p>
        <p className="text-xs text-muted mt-1 leading-relaxed">
          While a fan has no card on file, every photo and video you send shows
          blurred with a <b>Verify to view</b> button. Pressing it opens the
          Stripe card inputs right in the chat — to prevent fraud and keep
          underage users away from adult content. The card is saved with{" "}
          <b>no charge</b>, everything unblurs instantly, and one-tap purchases
          are enabled afterwards.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl bg-card2 border border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Require card verification</p>
          <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
            When off, fans see your photos and videos without verifying.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((v) => !v)}
          className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
            enabled ? "bg-accent" : "bg-line"
          }`}
          aria-label="Toggle card verification"
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Preview: what an unverified fan sees on your media */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Preview
        </p>
        <div className="relative w-64 h-44 rounded-3xl overflow-hidden bg-gradient-to-br from-accent/40 via-card2 to-accent/20 border border-line">
          <div className="absolute inset-0 backdrop-blur-2xl" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent text-white text-sm font-bold px-5 py-1.5 shadow-lg">
              <IconEye className="w-4 h-4" />
              Verify to view
            </span>
            <span className="text-white text-[11px] font-semibold drop-shadow">
              Free · no charge
            </span>
          </div>
        </div>
        <p className="text-[11px] text-muted">
          Shown on every photo and video until the fan verifies
          {enabled ? "" : " · currently off"}.
        </p>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {saved ? "Saved!" : saving ? "Saving…" : "Save"}
      </button>
      <p className="text-[11px] text-muted -mt-3">
        Fans who already registered a card (verified or topped up) always see
        your media normally.
      </p>
    </div>
  );
}
