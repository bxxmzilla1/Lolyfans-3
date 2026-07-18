"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconEye, IconEyeOff } from "./Icons";

/** Email + password login for guests who signed up through an invite link. */
export default function GuestLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/guest/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    if (!res.ok) {
      setBusy(false);
      const data = await res.json().catch(() => null);
      setError(data?.error || "Could not log in");
      return;
    }
    router.push("/chats");
    router.refresh();
  }

  const inputClass =
    "w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent transition-colors";

  return (
    <form onSubmit={login} className="w-full flex flex-col gap-3">
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
        className="w-full bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-40 active:opacity-80 transition-opacity"
      >
        {busy ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}
