"use client";

import { useEffect, useRef, useState } from "react";
import EmbeddedCardTopup from "./EmbeddedCardTopup";
import { elementsEnabled } from "@/lib/stripeClient";
import { IconLock, IconPlay, IconUser, IconVerified, IconCheck } from "./Icons";

type Intent = { clientSecret: string; amountCents: number; country: string | null };

type TgLogin = { name: string; hasCard: boolean };

/** Payload the Telegram Login Widget hands to the onauth callback. */
type TgAuthUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

declare global {
  interface Window {
    onTelegramAuth?: (user: TgAuthUser) => void;
  }
}

function priceLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/**
 * Fan-facing unlock page (opened from a Telegram DM link). One tap charges a
 * saved card and delivers the media to Telegram; new fans get the card wizard.
 * The Telegram Login Widget lets fans attach the card to their verified
 * Telegram identity — future unlocks are one tap without a Lolyfans account.
 */
export default function TelegramUnlockView({
  id,
  ownerName,
  avatarUrl,
  verified,
  mediaType,
  priceCents,
  alreadyUnlocked,
  botUsername,
  initialTgLogin,
}: {
  id: string;
  ownerName: string;
  avatarUrl: string | null;
  verified: boolean;
  mediaType: "image" | "video";
  priceCents: number;
  alreadyUnlocked: boolean;
  /** Login-widget bot (@ stripped); null = widget not configured. */
  botUsername: string | null;
  /** Fan already logged in with Telegram (from the cookie). */
  initialTgLogin: TgLogin | null;
}) {
  const [unlocked, setUnlocked] = useState(alreadyUnlocked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [tgLogin, setTgLogin] = useState<TgLogin | null>(initialTgLogin);
  const widgetRef = useRef<HTMLDivElement>(null);

  // Mount the Telegram Login Widget (it replaces the script tag with an
  // iframe button). The widget calls window.onTelegramAuth with the signed
  // payload, which our API verifies against the bot token.
  useEffect(() => {
    const holder = widgetRef.current;
    if (!botUsername || tgLogin || unlocked || !holder) return;

    window.onTelegramAuth = async (user: TgAuthUser) => {
      try {
        const res = await fetch("/api/telegram/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          setTgLogin({
            name: data.username
              ? `@${data.username}`
              : data.firstName || "Telegram",
            hasCard: false,
          });
        } else {
          setError(data.error || "Telegram login failed");
        }
      } catch {
        setError("Telegram login failed");
      }
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "24");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    holder.appendChild(script);

    return () => {
      holder.innerHTML = "";
      delete window.onTelegramAuth;
    };
  }, [botUsername, tgLogin, unlocked]);

  async function pay() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/telegram/unlock/${id}/pay`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.paid || data.alreadyUnlocked)) {
        setUnlocked(true);
        return;
      }
      if (res.ok && data.clientSecret) {
        if (!elementsEnabled()) {
          setError("Payments are not available right now.");
          return;
        }
        setIntent({
          clientSecret: data.clientSecret,
          amountCents: data.amountCents ?? priceCents,
          country: data.country ?? null,
        });
        return;
      }
      setError(data.error || "Could not start the payment");
    } catch {
      setError("Could not start the payment");
    } finally {
      setBusy(false);
    }
  }

  async function onCardSuccess(paymentIntentId: string) {
    const res = await fetch(`/api/telegram/unlock/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentIntentId }),
    }).catch(() => null);
    if (res?.ok) {
      setUnlocked(true);
      setIntent(null);
      return;
    }
    const data = await res?.json().catch(() => ({}));
    setError(data?.error || "Payment went through but delivery failed — contact the creator.");
  }

  return (
    <div className="min-h-dvh bg-bg text-fg flex flex-col items-center justify-center p-5">
      <div className="w-full max-w-sm space-y-5">
        {/* Creator */}
        <div className="flex items-center gap-3 justify-center">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={ownerName}
              className="w-11 h-11 rounded-full object-cover bg-card2"
            />
          ) : (
            <div className="w-11 h-11 rounded-full bg-card2 flex items-center justify-center">
              <IconUser className="w-5 h-5 text-muted" />
            </div>
          )}
          <p className="font-semibold flex items-center gap-1">
            {ownerName}
            {verified && <IconVerified className="w-4 h-4 text-sky-500" />}
          </p>
        </div>

        {/* Locked / unlocked media card */}
        <div className="relative aspect-[4/5] rounded-2xl overflow-hidden border border-line bg-card2">
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(145deg, color-mix(in oklab, var(--accent) 30%, var(--card2)) 0%, var(--card2) 60%, color-mix(in oklab, var(--line) 80%, var(--card2)) 100%)",
            }}
          />
          <div className="absolute inset-0 backdrop-blur-2xl" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
            {unlocked ? (
              <>
                <div className="w-14 h-14 rounded-2xl bg-green-500 flex items-center justify-center">
                  <IconCheck className="w-7 h-7 text-white" />
                </div>
                <p className="font-bold text-lg">Unlocked!</p>
                <p className="text-sm text-muted">
                  Your {mediaType} was sent to your Telegram chat with {ownerName}.
                  Open Telegram to view it.
                </p>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-2xl ig-gradient glow-accent flex items-center justify-center">
                  {mediaType === "video" ? (
                    <IconPlay className="w-6 h-6 text-white translate-x-px" />
                  ) : (
                    <IconLock className="w-6 h-6 text-white" />
                  )}
                </div>
                <p className="font-bold text-lg">Locked {mediaType}</p>
                <p className="text-sm text-muted">
                  Unlock to have it delivered to your Telegram chat with{" "}
                  {ownerName}.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Pay area */}
        {unlocked ? (
          <a
            href="https://t.me"
            className="block w-full text-center bg-accent text-white font-semibold rounded-full py-3 active:opacity-80 transition-opacity"
          >
            Open Telegram
          </a>
        ) : intent ? (
          <EmbeddedCardTopup
            clientSecret={intent.clientSecret}
            mode="payment"
            amountCents={intent.amountCents}
            label={`Unlock ${mediaType}`}
            countryGuess={intent.country}
            hideClose
            onSuccess={onCardSuccess}
            onCancel={() => setIntent(null)}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={pay}
              disabled={busy}
              className="w-full bg-accent text-white font-semibold rounded-full py-3.5 disabled:opacity-50 active:opacity-80 transition-opacity"
            >
              {busy ? "Starting…" : `Unlock · ${priceLabel(priceCents)}`}
            </button>
            {tgLogin ? (
              <p className="text-[11px] text-muted text-center">
                Logged in with Telegram as{" "}
                <span className="font-semibold text-fg">{tgLogin.name}</span>
                {tgLogin.hasCard
                  ? " · one-tap unlock ready"
                  : " · your card will be saved for one-tap unlocks"}
              </p>
            ) : (
              <p className="text-[11px] text-muted text-center">
                Secured by Stripe · One tap if your card is already saved
              </p>
            )}

            {/* Telegram Login Widget: attach the card to their Telegram
                identity so every future unlock is one tap. */}
            {botUsername && !tgLogin && (
              <div className="pt-1 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-[11px] text-muted">
                    or log in first
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <div ref={widgetRef} className="flex justify-center min-h-10" />
                <p className="text-[11px] text-muted text-center">
                  Log in with Telegram to save your card for one-tap unlocks
                  on any device.
                </p>
              </div>
            )}
          </>
        )}

        {error && <p className="text-sm text-red-400 text-center">{error}</p>}
      </div>
    </div>
  );
}
