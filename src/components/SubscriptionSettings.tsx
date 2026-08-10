"use client";

import { useEffect, useState } from "react";

/**
 * Creator settings: the site-wide main Telegram channel.
 * Anyone opening lolyfans.com (except /creator and owner tools) is sent here.
 * Invite links use their own redirect URLs and are not affected.
 */
export default function SubscriptionSettings() {
  const [telegramLink, setTelegramLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings/main-channel")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.link) setTelegramLink(String(data.link));
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    const res = await fetch("/api/settings/main-channel", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link: telegramLink }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Could not save");
      return;
    }
    setTelegramLink(String(data.link || telegramLink));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <p className="text-sm font-semibold">Main Telegram channel</p>
        <p className="text-xs text-muted mt-0.5">
          Visitors and users opening lolyfans.com are redirected here. This does
          not change your invite links — each invite has its own redirect URL.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold">
          Channel invite link <span className="text-red-400">*</span>
        </label>
        <input
          value={telegramLink}
          onChange={(e) => setTelegramLink(e.target.value)}
          disabled={loading}
          placeholder="https://t.me/+AbCdEfGhIjK"
          className="w-full bg-card2 border border-line rounded-xl px-4 py-3 text-sm placeholder:text-muted focus:border-accent outline-none disabled:opacity-50"
        />
        <p className="text-[11px] text-muted">
          Use a private invite link from Telegram → your channel → Invite links.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || loading || !telegramLink.trim()}
        className="w-full bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-50"
      >
        {saving ? "Saving…" : saved ? "Saved" : "Save"}
      </button>
    </div>
  );
}
