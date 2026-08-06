"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconLink, IconStar } from "./Icons";

const DEFAULT_BENEFITS = [
  "Unlimited chatting",
  "Unlimited free photos and video",
  "Chat unfiltered",
  "Completely private",
  "This person is ID verified",
];

/**
 * Settings → Chat per minute: the creator's shareable $1/min chat link and
 * the landing-page customization (bullet points, scarcity, countdown).
 */
export default function ChatPerMinuteSettings() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [linkText, setLinkText] = useState("Chat with me privately 💬");
  const [customUrl, setCustomUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState("");

  // Landing page customization
  const [benefitsText, setBenefitsText] = useState(DEFAULT_BENEFITS.join("\n"));
  const [slotsTotal, setSlotsTotal] = useState("");
  const [slotsLeft, setSlotsLeft] = useState("");
  const [timerMinutes, setTimerMinutes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cpm/link")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.url) {
          setUrl(data.url);
          if (Array.isArray(data.benefits) && data.benefits.length) {
            setBenefitsText((data.benefits as string[]).join("\n"));
          }
          if (typeof data.slotsTotal === "number") {
            setSlotsTotal(String(data.slotsTotal));
          }
          if (typeof data.slotsLeft === "number") {
            setSlotsLeft(String(data.slotsLeft));
          }
          if (typeof data.timerMinutes === "number") {
            setTimerMinutes(String(data.timerMinutes));
          }
        } else setError(data.error || "Could not load the link");
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

  async function saveLanding() {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/cpm/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          benefits: benefitsText
            .split("\n")
            .map((b) => b.trim())
            .filter(Boolean),
          slotsTotal: slotsTotal.trim() ? Number(slotsTotal) : null,
          slotsLeft: slotsLeft.trim() ? Number(slotsLeft) : null,
          timerMinutes: timerMinutes.trim() ? Number(timerMinutes) : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || "Could not save");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setSaveError("Could not save");
    } finally {
      setSaving(false);
    }
  }

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
        body: JSON.stringify({ text: linkText.trim(), url: customUrl.trim() }),
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
          billed every hour or when they leave. They show up in your
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
            Sends a link to your Telegram{" "}
            <span className="text-fg font-semibold">Saved Messages</span> as
            clickable words — copy and paste it into DMs or your channel and it
            opens in Telegram&apos;s in-app browser. Leave the link empty to
            use your Chat per minute link.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-fg/80">
            Link{" "}
            <span className="text-muted font-normal">
              (empty = your Chat per minute link)
            </span>
          </label>
          <input
            type="url"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            maxLength={500}
            placeholder={url || "https://…"}
            className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm placeholder:text-muted outline-none focus:border-violet-500/60"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-fg/80">
            Clickable text
          </label>
          <input
            type="text"
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
            maxLength={80}
            placeholder="Chat with me privately 💬"
            className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm placeholder:text-muted outline-none focus:border-violet-500/60"
          />
        </div>
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

      {/* Landing page customization: bullets, scarcity counters, countdown */}
      <div className="rounded-2xl border border-line bg-card2/60 p-4 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">
            Landing page
          </p>
          <p className="text-xs text-muted mt-1">
            Customize what fans see on the payment page.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-fg/80">
            Bullet points{" "}
            <span className="text-muted font-normal">(one per line)</span>
          </label>
          <textarea
            value={benefitsText}
            onChange={(e) => setBenefitsText(e.target.value)}
            rows={5}
            className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm placeholder:text-muted outline-none focus:border-violet-500/60 resize-y"
            placeholder={DEFAULT_BENEFITS.join("\n")}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-fg/80">
              Available for
            </label>
            <input
              type="number"
              min={1}
              value={slotsTotal}
              onChange={(e) => setSlotsTotal(e.target.value)}
              placeholder="e.g. 5"
              className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm placeholder:text-muted outline-none focus:border-violet-500/60"
            />
            <p className="text-[11px] text-muted">
              &ldquo;Available for 5 people only&rdquo; — empty hides it.
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-fg/80">
              Spots left
            </label>
            <input
              type="number"
              min={0}
              value={slotsLeft}
              onChange={(e) => setSlotsLeft(e.target.value)}
              placeholder="e.g. 2"
              className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm placeholder:text-muted outline-none focus:border-violet-500/60"
            />
            <p className="text-[11px] text-muted">
              How many are still open right now.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-fg/80">
            Countdown timer{" "}
            <span className="text-muted font-normal">(minutes)</span>
          </label>
          <input
            type="number"
            min={0}
            value={timerMinutes}
            onChange={(e) => setTimerMinutes(e.target.value)}
            placeholder="e.g. 15"
            className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm placeholder:text-muted outline-none focus:border-violet-500/60"
          />
          <p className="text-[11px] text-muted">
            Each visitor sees their own &ldquo;offer ends in&rdquo; countdown of
            this length. Empty or 0 turns it off.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void saveLanding()}
          disabled={saving}
          className="w-full rounded-xl bg-violet-500 hover:bg-violet-500/90 text-white text-sm font-bold py-2.5 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saved ? (
            <>
              <IconCheck className="w-4 h-4" /> Saved
            </>
          ) : saving ? (
            "Saving…"
          ) : (
            "Save landing page"
          )}
        </button>
        {saveError && <p className="text-xs text-red-400">{saveError}</p>}
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
          Returning fans with a saved card skip the paywall. Metering only
          restarts when they send a message or interact with a video — going
          Idle settles their session and stops charges.
        </li>
      </ul>
    </div>
  );
}
