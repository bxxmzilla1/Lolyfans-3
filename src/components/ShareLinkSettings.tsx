"use client";

import { useState } from "react";
import { IconCheck, IconLink } from "./Icons";

/**
 * Settings → Share link: turn any URL into bold clickable words and send
 * them to Telegram Saved Messages for easy copy/paste into DMs or channels.
 */
export default function ShareLinkSettings() {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("Tap here");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function sendToSaved() {
    if (sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/telegram/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), text: text.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not send");
        return;
      }
      setSent(true);
      setTimeout(() => setSent(false), 2200);
    } catch {
      setError("Could not send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <p className="text-sm font-semibold">Share as clickable text</p>
        <p className="text-xs text-muted mt-0.5">
          Sends a bold clickable link to your Telegram{" "}
          <span className="text-fg font-semibold">Saved Messages</span> — copy
          and paste it into DMs or your channel. It opens in Telegram&apos;s
          in-app browser.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-fg/80">
          Link <span className="text-red-400">*</span>
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          maxLength={500}
          placeholder="https://…"
          className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm placeholder:text-muted outline-none focus:border-accent"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-fg/80">
          Clickable text
        </label>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={80}
          placeholder="Tap here"
          className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm placeholder:text-muted outline-none focus:border-accent"
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="button"
        onClick={() => void sendToSaved()}
        disabled={sending || !url.trim()}
        className="w-full rounded-xl bg-accent text-white text-sm font-bold py-3 flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {sent ? (
          <>
            <IconCheck className="w-4 h-4" /> Sent to Saved Messages
          </>
        ) : sending ? (
          "Sending…"
        ) : (
          <>
            <IconLink className="w-4 h-4" /> Send to Saved Messages
          </>
        )}
      </button>
    </div>
  );
}
