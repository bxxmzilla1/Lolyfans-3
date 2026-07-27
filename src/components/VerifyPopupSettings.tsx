"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { DEFAULT_VERIFY_POPUP } from "@/lib/popupOffer";

/**
 * Verify pop up tab: the creator sets how many messages a fan can send
 * before a popup asks them to verify with a card (Stripe SetupIntent — no
 * charge). Fans with a card on file never see it.
 */
export default function VerifyPopupSettings() {
  const [enabled, setEnabled] = useState(DEFAULT_VERIFY_POPUP.enabled);
  const [messages, setMessages] = useState(String(DEFAULT_VERIFY_POPUP.messages));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = data.user?.user_metadata ?? {};
        setEnabled(meta.verify_popup_enabled !== false);
        if (Number(meta.verify_popup_messages) > 0)
          setMessages(String(meta.verify_popup_messages));
      });
  }, []);

  const messagesNum = Math.round(Number(messages));
  const valid = messagesNum > 0;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await supabaseBrowser().auth.updateUser({
        data: {
          verify_popup_enabled: enabled,
          verify_popup_messages: messagesNum,
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
        <p className="font-semibold">Verification popup</p>
        <p className="text-xs text-muted mt-1 leading-relaxed">
          After a fan sends the number of messages below without a card on
          file, they see a popup asking them to verify with a card — to
          prevent fraud and keep underage users away from adult content. The
          card is saved through Stripe with <b>no charge</b>, and also enables
          one-tap purchases afterwards.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl bg-card2 border border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Show verification popup</p>
          <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
            When off, fans are never asked to verify.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((v) => !v)}
          className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
            enabled ? "bg-accent" : "bg-line"
          }`}
          aria-label="Toggle the verification popup"
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div className={`space-y-1.5 ${enabled ? "" : "opacity-40"}`}>
        <label className="text-xs font-semibold text-muted uppercase tracking-wide">
          Messages before the popup
        </label>
        <input
          value={messages}
          onChange={(e) => setMessages(e.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          placeholder="5"
          className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
        />
        <p className="text-[11px] text-muted">
          The popup appears once the fan has sent this many messages.
        </p>
      </div>

      {/* Live preview of the fan's popup */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Preview
        </p>
        <div className="relative bg-card border border-accent/40 rounded-3xl p-6 text-center space-y-2.5 overflow-hidden">
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-36 rounded-full bg-accent/25 blur-3xl pointer-events-none" />
          <p className="relative text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
            Verification required
          </p>
          <p className="relative text-lg font-extrabold leading-snug">
            Verify your account
          </p>
          <p className="relative text-xs text-muted leading-relaxed">
            To protect against fraud and keep anyone under 18 away from adult
            content, we ask you to verify your identity with a card.
          </p>
          <p className="relative text-xs font-bold text-emerald-500">
            No payment will be made — verification is free.
          </p>
          <p className="relative text-[11px] text-muted">
            Appears after {valid ? messagesNum : 0}{" "}
            {messagesNum === 1 ? "message" : "messages"}
            {enabled ? "" : " · currently off"}
          </p>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving || !valid}
        className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {saved ? "Saved!" : saving ? "Saving…" : "Save"}
      </button>
      <p className="text-[11px] text-muted -mt-3">
        Fans who already registered a card (verified or topped up) never see
        the popup.
      </p>
    </div>
  );
}
