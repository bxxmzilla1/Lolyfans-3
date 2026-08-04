"use client";

import { useEffect, useRef, useState } from "react";
import EmojiQuickBar from "./EmojiQuickBar";
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
  initialPeer,
  peerLabel,
  onClose,
}: {
  mediaPath: string;
  mediaType: "image" | "video";
  /** Prefill / lock the destination (from an open Telegram inbox chat). */
  initialPeer?: string;
  peerLabel?: string;
  onClose: () => void;
}) {
  const [peer, setPeer] = useState(initialPeer ?? "");
  const [price, setPrice] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const captionRef = useRef<HTMLTextAreaElement>(null);

  // Sent: flash the checkmark animation, then close on our own — no button.
  useEffect(() => {
    if (!sent) return;
    const timer = setTimeout(onClose, 1200);
    return () => clearTimeout(timer);
  }, [sent, onClose]);

  const priceCents = Math.round(parseFloat(price) * 100) || 0;
  const isFree = priceCents <= 0;
  // Empty price = free send; a typed price must be at least $1.
  const invalid = !peer.trim() || (!isFree && priceCents < 100);
  const peerLocked = Boolean(initialPeer);

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

  // Success flash: just the animated check over the dimmed backdrop, then
  // the sheet closes itself.
  if (sent) {
    return (
      <Portal>
        <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative flex flex-col items-center gap-3">
            <span className="absolute top-0 w-20 h-20 rounded-full bg-green-500/60 check-ripple" />
            <div className="relative w-20 h-20 rounded-full bg-green-500 flex items-center justify-center shadow-xl check-pop">
              <IconCheck className="w-10 h-10 text-white" />
            </div>
            <p className="font-semibold text-white drop-shadow fade-up">
              {isFree ? "Sent" : "Locked & sent"}
            </p>
          </div>
        </div>
      </Portal>
    );
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

          <>
              <div className="space-y-2">
                <label className="text-sm font-semibold">
                  Fan&apos;s Telegram
                </label>
                {peerLocked ? (
                  <div className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm truncate">
                    {peerLabel ||
                      (peer.startsWith("@") || peer.startsWith("+")
                        ? peer
                        : "This chat")}
                  </div>
                ) : (
                  <input
                    value={peer}
                    onChange={(e) => setPeer(e.target.value)}
                    placeholder="@username or +1555…"
                    className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
                  />
                )}
                {!peerLocked && (
                  <p className="text-xs text-muted">
                    You must have an existing Telegram chat with this person (or
                    their privacy must allow messages).
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">
                  Unlock price{" "}
                  <span className="text-muted font-normal">
                    (leave empty to send free)
                  </span>
                </label>
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
                  <p className="text-xs text-red-400">
                    Minimum price is $1 — or clear it to send free
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">
                  Message <span className="text-muted font-normal">(optional)</span>
                </label>
                <EmojiQuickBar
                  onInsert={(emoji) => {
                    setCaption((prev) => `${prev}${emoji}`);
                    captionRef.current?.focus();
                  }}
                  className="-mx-1 rounded-xl bg-card2/60"
                />
                <textarea
                  ref={captionRef}
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
                {busy
                  ? "Sending…"
                  : isFree
                  ? "Send for free"
                  : "Send locked media"}
              </button>
          </>
        </div>
      </div>
    </Portal>
  );
}
