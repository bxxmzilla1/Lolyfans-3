"use client";

import { useState } from "react";
import Portal from "./Portal";
import { IconShield } from "./Icons";

// Remembered for the rest of the page session once verified,
// so the code is only asked for once.
let cachedCode: string | null = null;

export function getCachedAdminCode(): string | null {
  return cachedCode;
}

export function clearCachedAdminCode() {
  cachedCode = null;
}

/** Themed dialog that asks for the admin code and verifies it server-side. */
export default function AdminCodeDialog({
  title = "Admin code required",
  message = "Enter the admin code to continue.",
  onVerified,
  onCancel,
}: {
  title?: string;
  message?: string;
  onVerified: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function verify() {
    if (!code || loading) return;
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setLoading(false);
    if (res.ok) {
      cachedCode = code;
      onVerified(code);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Invalid admin code");
    }
  }

  return (
    <Portal>
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs bg-card border border-line rounded-2xl p-4 space-y-3 fade-up"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl ig-gradient glow-accent flex items-center justify-center shrink-0">
            <IconShield className="w-4.5 h-4.5 text-white" />
          </div>
          <p className="font-bold">{title}</p>
        </div>
        <p className="text-sm text-muted">{message}</p>
        <input
          autoFocus
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && verify()}
          placeholder="Admin code"
          autoComplete="off"
          className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
        />
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 bg-card2 border border-line rounded-xl py-2.5 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={verify}
            disabled={!code || loading}
            className="flex-1 bg-accent text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "Checking…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
