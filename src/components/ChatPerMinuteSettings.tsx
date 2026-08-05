"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconLink, IconStar } from "./Icons";

/**
 * Settings → Chat per minute: the creator's shareable $1/min chat link.
 */
export default function ChatPerMinuteSettings() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [linkText, setLinkText] = useState("Chat with me privately 💬");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cpm/link")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.url) setUrl(data.url);
        else setError(data.error || "Could not load the link");
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the link");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy — select the link and copy it manually");
    }
  }

  async function sendToSaved() {
    if (sending) return;
    setSending(true);
    setSendError("");
    try {
      const res = await fetch("/api/cpm/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: linkText.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendError(data.error || "Could not send");
        return;
      }
      setSent(true);
      setTimeout(() => setSent(false), 2200);
    } catch {
      setSendError("Could not send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-extrabold flex items-center gap-2">
          <IconStar className="w-5 h-5 text-amber-400" />
          Chat per minute
        </h2>
        <p className="text-sm text-muted mt-1">
          Share this link. Fans verify a card, then chat with you on Lolyfans
          at <span className="text-fg font-semibold">$1 per minute</span> —
          billed every 10 minutes or when they leave. They show up in your
          sidebar in purple with a gold star.
        </p>
      </div>

      <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-300">
          Your link
        </p>
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : error && !url ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : (
          <>
            <div className="flex items-center gap-2 bg-card border border-line rounded-xl px-3 py-2.5">
              <IconLink className="w-4 h-4 text-violet-300 shrink-0" />
              <input
                readOnly
                value={url}
                className="flex-1 bg-transparent text-sm outline-none truncate"
                onFocus={(e) => e.target.select()}
              />
            </div>
            <button
              type="button"
              onClick={() => void copy()}
              className="w-full rounded-xl bg-violet-500 hover:bg-violet-500/90 text-white text-sm font-bold py-2.5 flex items-center justify-center gap-2"
            >
              {copied ? (
                <>
                  <IconCheck className="w-4 h-4" /> Copied
                </>
              ) : (
                "Copy link"
              )}
            </button>
          </>
        )}
      </div>

      {/* Pretty link → Saved Messages: clickable words instead of a raw URL */}
      <div className="rounded-2xl border border-line bg-card2/60 p-4 space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">
            Share as clickable text
          </p>
          <p className="text-xs text-muted mt-1">
            Sends the link to your Telegram{" "}
            <span className="text-fg font-semibold">Saved Messages</span> as
            clickable words — copy and paste it into DMs or your channel and it
            opens the payment page in Telegram&apos;s in-app browser.
          </p>
        </div>
        <input
          type="text"
          value={linkText}
          onChange={(e) => setLinkText(e.target.value)}
          maxLength={80}
          placeholder="Chat with me privately 💬"
          className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm placeholder:text-muted outline-none focus:border-violet-500/60"
        />
        <button
          type="button"
          onClick={() => void sendToSaved()}
          disabled={sending}
          className="w-full rounded-xl border border-violet-500/40 bg-violet-500/10 hover:bg-violet-500/20 text-violet-200 text-sm font-bold py-2.5 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {sent ? (
            <>
              <IconCheck className="w-4 h-4" /> Sent to Saved Messages
            </>
          ) : sending ? (
            "Sending…"
          ) : (
            "Send to Saved Messages"
          )}
        </button>
        {sendError && <p className="text-xs text-red-400">{sendError}</p>}
      </div>

      <ul className="text-sm text-muted space-y-1.5 list-disc pl-5">
        <li>New fans see a TelegramPay page with the benefits and $1/min.</li>
        <li>Their first minute is charged when they tap Start Chatting.</li>
        <li>
          The link opens on Lolyfans, then unpaid fans are sent to your
          pay domain for the card page; after paying they land in chat with
          metering already running.
        </li>
        <li>
          Returning fans with a saved card skip the paywall — metering
          restarts the moment their chat loads.
        </li>
      </ul>
    </div>
  );
}
