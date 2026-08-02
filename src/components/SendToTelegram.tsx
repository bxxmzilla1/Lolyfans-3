"use client";

import { useState } from "react";
import Portal from "./Portal";
import { IconCheck, IconSend } from "./Icons";

/**
 * Sheet for sending one vault item into a fan's Telegram DM as a locked,
 * pay-to-unlock teaser. Requires the creator's Telegram account to be
 * connected (Settings → Telegram).
 */
export default function SendToTelegram({
  mediaPath,
  mediaType,
  onClose,
}: {
  mediaPath: string;
  mediaType: "image" | "video";
  onClose: () => void;
}) {
  const [peer, setPeer] = useState("");
  const [price, setPrice] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const priceCents = Math.round(parseFloat(price) * 100) || 0;
  const invalid = !peer.trim() || priceCents < 100;

  async function send() {
    if (busy || invalid) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/telegram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaPath,
          mediaType,
          priceCents,
          peer: peer.trim(),
          caption: caption.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSent(true);
      } else {
        setError(data.error || "Could not send");
      }
    } catch {
      setError("Could not send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm bg-card border border-line rounded-2xl p-5 space-y-4 fade-up"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="font-bold flex items-center gap-2">
              <IconSend className="w-4.5 h-4.5 text-accent" /> Send to Telegram
            </p>
            <button
              onClick={onClose}
              className="text-muted text-sm px-1"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {sent ? (
            <div className="py-4 flex flex-col items-center gap-3 text-center">
              <div className="w-14 h-14 rounded-2xl bg-green-500 flex items-center justify-center">
                <IconCheck className="w-7 h-7 text-white" />
              </div>
              <p className="font-semibold">Locked {mediaType} sent</p>
              <p className="text-sm text-muted">
                The fan got a blurred preview with a pay link. Once they pay,
                the clear {mediaType} is delivered into their Telegram chat with
                you automatically.
              </p>
              <button
                onClick={onClose}
                className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm mt-1"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-semibold">
                  Fan&apos;s Telegram
                </label>
                <input
                  value={peer}
                  onChange={(e) => setPeer(e.target.value)}
                  placeholder="@username or +1555…"
                  className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
                />
                <p className="text-xs text-muted">
                  You must have an existing Telegram chat with this person (or
                  their privacy must allow messages).
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Unlock price</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted">$</span>
                  <input
                    value={price}
                    onChange={(e) =>
                      setPrice(e.target.value.replace(/[^\d.]/g, ""))
                    }
                    inputMode="decimal"
                    placeholder="9.99"
                    className="flex-1 bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
                  />
                </div>
                {price !== "" && priceCents < 100 && (
                  <p className="text-xs text-red-400">Minimum price is $1</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">
                  Message <span className="text-muted font-normal">(optional)</span>
                </label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={2}
                  maxLength={300}
                  placeholder="Just for you 😘"
                  className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none resize-none"
                />
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <button
                onClick={send}
                disabled={busy || invalid}
                className="w-full bg-accent text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
              >
                {busy ? "Sending…" : "Send locked media"}
              </button>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
}
