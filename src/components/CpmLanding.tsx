"use client";

import { useState } from "react";
import EmbeddedCardTopup from "./EmbeddedCardTopup";
import { elementsEnabled } from "@/lib/stripeClient";
import { IconCheck, IconUser, IconVerified } from "./Icons";

const BENEFITS = [
  "Unlimited chatting",
  "Unlimited free photos and video",
  "Chat unfiltered",
  "Completely private",
  "This person is ID verified",
];

type Intent = {
  clientSecret: string;
  amountCents: number;
  country: string | null;
  chatId: string;
};

/**
 * Chat-per-minute paywall (TelegramPay branded). Fans without a saved card
 * see benefits + $1/min and enter their card; returning fans with a card go
 * straight into the chat.
 */
export default function CpmLanding({
  code,
  ownerName,
  verified,
  appOrigin,
}: {
  code: string;
  ownerName: string;
  verified: boolean;
  /** Lolyfans origin — after paying we claim the cookie there, then /chat. */
  appOrigin: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);

  function goToChatAfterPay(chatId: string, paymentIntentId: string) {
    // Must land on the app domain so the guest cookie is set there (not on
    // the pay-link domain), then the claim route redirects to /chat.
    const q = new URLSearchParams({
      code,
      chatId,
      paymentIntentId,
    });
    window.location.href = `${appOrigin.replace(/\/+$/, "")}/api/cpm/claim?${q}`;
  }

  async function start() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/cpm/${encodeURIComponent(code)}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No name here — the cardholder name from the card form becomes the
        // fan's display name after payment.
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.resume && data.chatId) {
        // Resume only works when the cookie is already on this domain
        // (rare on the pay domain) — send them to the app chat.
        window.location.href = `${appOrigin.replace(/\/+$/, "")}/chat`;
        return;
      }
      if (res.ok && data.clientSecret) {
        if (!elementsEnabled()) {
          setError("Payments are not available right now.");
          return;
        }
        setIntent({
          clientSecret: data.clientSecret,
          amountCents: data.amountCents ?? 100,
          country: data.country ?? null,
          chatId: data.chatId,
        });
        return;
      }
      setError(data.error || "Could not start chatting");
    } catch {
      setError("Could not start chatting");
    } finally {
      setBusy(false);
    }
  }

  async function onCardSuccess(paymentIntentId: string) {
    if (!intent) return;
    goToChatAfterPay(intent.chatId, paymentIntentId);
  }

  return (
    <div className="min-h-dvh bg-bg text-fg flex flex-col items-center justify-center p-5">
      <div className="w-full max-w-sm space-y-5">
        {/* TelegramPay wordmark */}
        <div className="flex flex-col items-center gap-1.5 pb-1">
          <div className="flex items-center justify-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/telegrampay-logo.webp"
              alt="TelegramPay"
              className="w-8 h-8"
            />
            <p className="text-xl font-extrabold tracking-tight">
              Telegram<span className="text-[#2AABEE]">Pay</span>
            </p>
          </div>
          <p className="text-[11px] text-muted tracking-wide">
            Safe payments on Telegram
          </p>
        </div>

        {/* Creator */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-card2 border border-line flex items-center justify-center">
            {!avatarFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/cpm/${encodeURIComponent(code)}/avatar`}
                alt={ownerName}
                className="w-full h-full object-cover"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <IconUser className="w-7 h-7 text-muted" />
            )}
          </div>
          <p className="font-bold text-base flex items-center gap-1">
            {ownerName}
            {verified && <IconVerified className="w-4 h-4 text-sky-500" />}
          </p>
        </div>

        {/* Offer */}
        <div className="rounded-2xl border border-line bg-card2/80 p-4 space-y-3">
          <div className="text-center">
            <p className="text-3xl font-extrabold tracking-tight">
              $1<span className="text-lg font-bold text-muted">/min</span>
            </p>
            <p className="text-xs text-muted mt-0.5">Chat per minute</p>
          </div>
          <ul className="space-y-2">
            {BENEFITS.map((b) => (
              <li
                key={b}
                className="flex items-start gap-2 text-sm text-fg/90"
              >
                <span className="mt-0.5 w-5 h-5 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
                  <IconCheck className="w-3 h-3" />
                </span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>

        {intent ? (
          <EmbeddedCardTopup
            clientSecret={intent.clientSecret}
            mode="payment"
            amountCents={intent.amountCents}
            label="Start chatting"
            countryGuess={intent.country}
            hideClose
            onSuccess={onCardSuccess}
            onCancel={() => setIntent(null)}
          />
        ) : (
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => void start()}
              disabled={busy}
              className="w-full bg-accent text-white font-semibold rounded-full py-3.5 disabled:opacity-50 active:opacity-80 transition-opacity"
            >
              {busy ? "Starting…" : "Start Chatting"}
            </button>
            <p className="text-[11px] text-muted text-center">
              Secured by Stripe · First minute charged when you start · then
              every 30 minutes
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-400 text-center">{error}</p>}
      </div>
    </div>
  );
}
