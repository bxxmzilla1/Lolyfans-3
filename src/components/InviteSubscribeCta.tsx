"use client";

import { useState } from "react";
import Portal from "./Portal";
import { IconEye, IconEyeOff } from "./Icons";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Invite-profile "Join Private Telegram Channel" button. Opens a sign-up
 * sheet (email + password only) over the profile; after join, sends the fan
 * into the creator's Telegram channel. No subscription payment.
 */
export default function InviteSubscribeCta({
  code,
  ownerId,
}: {
  code: string;
  ownerId: string;
  ownerName?: string;
  plan?: unknown;
  initialOpen?: boolean;
  alreadyJoined?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function goToChannel() {
    try {
      const res = await fetch(`/api/payments/subscribe/link?ownerId=${ownerId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.link === "string" && data.link) {
        window.location.href = data.link;
        return;
      }
    } catch {}
    window.location.href = "/home";
  }

  async function signup() {
    if (busy) return;
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter a valid email address");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        email: email.trim(),
        password,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(data?.error || "Could not sign up");
      return;
    }
    await goToChannel();
  }

  const inputClass =
    "w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent outline-none transition-colors";

  return (
    <>
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full py-3 px-5 rounded-full bg-accent text-white text-sm font-semibold text-center active:opacity-80 transition-opacity"
        >
          JOIN PRIVATE TELEGRAM CHANNEL
        </button>
        <p className="text-xs text-muted text-center">Free to join</p>
      </div>

      {open && (
        <Portal>
          <div
            className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-md flex items-end sm:items-center justify-center p-4"
            onClick={() => setOpen(false)}
          >
            <div
              className="bg-card border border-line rounded-2xl p-5 w-full max-w-sm fade-up max-h-[90dvh] overflow-y-auto space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-bold">Join Private Telegram Channel</p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-muted text-sm px-1"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-muted">
                  Create a free account, then join the private channel.
                </p>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  maxLength={254}
                  className={inputClass}
                />
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a password"
                    minLength={6}
                    className={`${inputClass} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg transition-colors p-1"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <IconEyeOff className="w-5 h-5" />
                    ) : (
                      <IconEye className="w-5 h-5" />
                    )}
                  </button>
                </div>
                {error && (
                  <p className="text-red-400 text-sm text-center">{error}</p>
                )}
                <button
                  type="button"
                  onClick={() => void signup()}
                  disabled={busy || !email.trim() || password.length < 6}
                  className="w-full bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-40 active:opacity-80 transition-opacity"
                >
                  {busy ? "Joining…" : "Join the channel"}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
