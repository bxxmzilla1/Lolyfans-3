"use client";

import { useEffect, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

type Status = "disconnected" | "code_sent" | "password_needed" | "connected";

/**
 * Settings → Telegram: connect the creator's own Telegram account so locked
 * vault media can be sent into fans' DMs with a pay link. Three-step login
 * (phone → code → optional 2FA password) driven by /api/telegram/connect.
 */
export default function TelegramSettings() {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [status, setStatus] = useState<Status>("disconnected");
  const [username, setUsername] = useState<string | null>(null);
  const [phoneShown, setPhoneShown] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/telegram/account");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setConfigured(!!data.configured);
        setStatus((data.status as Status) ?? "disconnected");
        setUsername(data.username ?? null);
        setPhoneShown(data.phone ?? null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function call(action: string, extra: Record<string, string>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/telegram/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      setStatus((data.status as Status) ?? status);
      if (data.username) setUsername(data.username);
      if (data.status === "connected") {
        setCode("");
        setPassword("");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setConfirmDisconnect(false);
    setBusy(true);
    try {
      await fetch("/api/telegram/account", { method: "DELETE" });
      setStatus("disconnected");
      setUsername(null);
      setPhone("");
      setCode("");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-lg space-y-3">
        <div className="h-4 w-40 bg-card2 rounded animate-pulse" />
        <div className="h-24 bg-card2 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <p className="text-sm font-semibold">Sell in Telegram DMs</p>
        <p className="text-xs text-muted mt-0.5">
          Connect your own Telegram account, then send locked vault media into
          a fan&apos;s DM from the Vault tab. Fans tap the link, pay (one tap if
          they already saved a card here), and the media is delivered straight
          into their Telegram chat with you.
        </p>
      </div>

      {!configured && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-xs text-amber-500">
          Telegram isn&apos;t configured on the server yet. Ask the admin to set
          <b> TELEGRAM_API_ID</b> and <b>TELEGRAM_API_HASH</b>.
        </div>
      )}

      <div className="rounded-xl border border-line bg-card2 px-3.5 py-3 text-xs text-muted">
        Optional: with <b>TELEGRAM_BOT_TOKEN</b> and{" "}
        <b>TELEGRAM_BOT_USERNAME</b> set on the server (and the site domain set
        via @BotFather&apos;s /setdomain), unlock pages show a &quot;Log in with
        Telegram&quot; button — fans&apos; cards are then saved to their
        Telegram identity for one-tap unlocks, no sign-up needed.
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-3 text-xs text-muted">
        Automating a personal account is against Telegram&apos;s Terms of
        Service and can get the account limited. Keep volume low and use at your
        own risk.
      </div>

      {status === "connected" ? (
        <div className="rounded-xl border border-line bg-card2 px-3.5 py-3 space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Connected</p>
              <p className="text-xs text-muted truncate">
                {username ? `@${username}` : phoneShown || "Your Telegram account"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setConfirmDisconnect(true)}
            disabled={busy}
            className="w-full bg-card border border-line text-red-400 hover:text-red-500 font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 transition-colors"
          >
            Disconnect Telegram
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-card2 px-3.5 py-3.5 space-y-3">
          {(status === "disconnected" || status === "code_sent") && (
            <div className="space-y-2">
              <label className="text-sm font-semibold">Phone number</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 123 4567"
                disabled={status === "code_sent"}
                className="w-full bg-card border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none disabled:opacity-60"
              />
              {status === "disconnected" && (
                <button
                  type="button"
                  onClick={() => call("send-code", { phone })}
                  disabled={busy || !phone.trim()}
                  className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
                >
                  {busy ? "Sending…" : "Send login code"}
                </button>
              )}
            </div>
          )}

          {status === "code_sent" && (
            <div className="space-y-2">
              <label className="text-sm font-semibold">Login code</label>
              <p className="text-xs text-muted">
                Telegram sent a code to your account (check the Telegram app).
              </p>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="12345"
                className="w-full bg-card border border-line rounded-xl px-3 py-2.5 text-sm text-center tracking-widest placeholder:text-muted focus:border-accent outline-none"
              />
              <button
                type="button"
                onClick={() => call("verify-code", { code })}
                disabled={busy || !code.trim()}
                className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
              >
                {busy ? "Verifying…" : "Verify code"}
              </button>
            </div>
          )}

          {status === "password_needed" && (
            <div className="space-y-2">
              <label className="text-sm font-semibold">2FA password</label>
              <p className="text-xs text-muted">
                Your account has two-step verification. Enter your Telegram
                password to finish.
              </p>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Telegram password"
                className="w-full bg-card border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
              />
              <button
                type="button"
                onClick={() => call("verify-password", { password })}
                disabled={busy || !password}
                className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
              >
                {busy ? "Verifying…" : "Finish connecting"}
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {confirmDisconnect && (
        <ConfirmDialog
          title="Disconnect Telegram"
          message="Stop using your connected Telegram account? Existing unlock links keep working, but you won't be able to send new ones until you reconnect."
          confirmLabel="Disconnect"
          onConfirm={disconnect}
          onCancel={() => setConfirmDisconnect(false)}
        />
      )}
    </div>
  );
}
