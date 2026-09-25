"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconEye, IconEyeOff } from "./Icons";
import { ensurePhantomOrRedirect, isPhantomCancel, signInWithPhantom } from "@/lib/phantom";

/**
 * Fan login: Continue with Phantom. Accounts created before wallet sign-up
 * can still use their email + password (behind a link).
 */
export default function GuestLoginForm() {
  const [legacy, setLegacy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  function finish(data: { redirect?: unknown }) {
    // Fans who owe the current period land on the payment step, not the app.
    router.push(typeof data.redirect === "string" ? data.redirect : "/home");
    router.refresh();
  }

  async function loginWithPhantom() {
    if (busy) return;
    if (!ensurePhantomOrRedirect()) {
      setError("Install the Phantom wallet, then come back to this page.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Sign the message in Phantom…");
    try {
      const signed = await signInWithPhantom();
      setStatus("Opening your chats…");
      const res = await fetch("/api/guest/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signed),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not log in");
      finish(data);
    } catch (err) {
      setStatus(null);
      setBusy(false);
      setError(
        isPhantomCancel(err) ? "Cancelled in Phantom." : err instanceof Error ? err.message : "Could not log in"
      );
    }
  }

  async function loginWithEmail(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/guest/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(data?.error || "Could not log in");
      return;
    }
    finish(data);
  }

  const inputClass =
    "w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent transition-colors";

  return (
    <div className="w-full flex flex-col gap-3">
      <button
        type="button"
        onClick={() => void loginWithPhantom()}
        disabled={busy}
        className="w-full bg-[#AB9FF2] text-[#1C1C1C] font-semibold rounded-xl py-3 disabled:opacity-40 active:opacity-80 transition-opacity"
      >
        {status ?? "Continue with Phantom"}
      </button>
      {!legacy && error && <p className="text-red-400 text-sm text-center">{error}</p>}

      {legacy ? (
        <form onSubmit={loginWithEmail} className="w-full flex flex-col gap-3 pt-2">
          <p className="text-xs text-muted text-center">Signed up with an email before?</p>
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className={`${inputClass} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg transition-colors p-1"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <IconEyeOff className="w-5 h-5" /> : <IconEye className="w-5 h-5" />}
            </button>
          </div>
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={busy || !email.trim() || !password}
            className="w-full bg-card2 border border-line font-semibold rounded-xl py-3 disabled:opacity-40 active:opacity-80 transition-opacity"
          >
            {busy ? "Logging in…" : "Log in with email"}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setLegacy(true)}
          className="text-xs text-muted underline underline-offset-2 text-center"
        >
          Signed up with an email before?
        </button>
      )}
    </div>
  );
}
