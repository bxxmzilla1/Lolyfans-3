"use client";

import { useEffect, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { IconCheck, IconStar } from "./Icons";

/**
 * Settings → Stars Mini App: connect a BotFather bot so fans can chat and
 * pay PPVs with Telegram Stars inside the Mini App.
 */
export default function StarsBotSettings() {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [miniAppUrl, setMiniAppUrl] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  async function load() {
    const res = await fetch("/api/telegram/bot").catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setBotUsername(data.botUsername ?? null);
      setMiniAppUrl(data.miniAppUrl ?? null);
      setDeepLink(data.deepLink ?? null);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function connect() {
    if (busy || !token.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/telegram/bot", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not connect");
        return;
      }
      setToken("");
      setBotUsername(data.botUsername ?? null);
      setMiniAppUrl(data.miniAppUrl ?? null);
      setDeepLink(data.deepLink ?? null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setConfirmOff(false);
    setBusy(true);
    await fetch("/api/telegram/bot", { method: "DELETE" });
    setBotUsername(null);
    setMiniAppUrl(null);
    setDeepLink(null);
    setBusy(false);
  }

  if (loading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <p className="text-sm font-semibold flex items-center gap-2">
          <IconStar className="w-4 h-4 text-amber-400" />
          Stars Mini App
        </p>
        <p className="text-xs text-muted mt-0.5">
          Connect a bot from @BotFather. Fans open your Mini App inside
          Telegram to chat with you and unlock PPVs with{" "}
          <span className="text-fg font-semibold">Telegram Stars</span> — no
          Stripe. Earnings go to your bot&apos;s Stars balance.
        </p>
      </div>

      {botUsername ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-200">
            Connected · @{botUsername}
          </p>
          {deepLink && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Share with fans
              </p>
              <input
                readOnly
                value={deepLink}
                className="w-full bg-card border border-line rounded-xl px-3 py-2 text-sm"
                onFocus={(e) => e.target.select()}
              />
            </div>
          )}
          {miniAppUrl && (
            <p className="text-[11px] text-muted break-all">
              Mini App URL (also set as the bot menu button): {miniAppUrl}
            </p>
          )}
          <ol className="text-xs text-muted list-decimal pl-4 space-y-1">
            <li>In @BotFather → your bot → Bot Settings → configure Menu Button if needed</li>
            <li>Share the t.me link above — fans tap Open chat / Mini App</li>
            <li>Reply and send Stars PPVs from the Stars section in your inbox</li>
          </ol>
          <button
            type="button"
            onClick={() => setConfirmOff(true)}
            disabled={busy}
            className="w-full rounded-xl border border-line bg-card2 py-2.5 text-sm font-semibold text-red-400"
          >
            Disconnect bot
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="text-xs font-semibold text-fg/80">
            Bot token from @BotFather
          </label>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="123456:ABC-DEF…"
            className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm placeholder:text-muted outline-none focus:border-accent font-mono"
          />
          <p className="text-[11px] text-muted">
            Create a bot with @BotFather → /newbot, then paste the token here.
            We set the webhook and Mini App menu automatically.
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy || !token.trim()}
            className="w-full rounded-xl bg-accent text-white text-sm font-bold py-3 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saved ? (
              <>
                <IconCheck className="w-4 h-4" /> Connected
              </>
            ) : busy ? (
              "Connecting…"
            ) : (
              "Connect bot"
            )}
          </button>
        </div>
      )}

      {confirmOff && (
        <ConfirmDialog
          title="Disconnect Stars bot?"
          message="Fans won't be able to open the Mini App or pay with Stars until you connect a bot again."
          onConfirm={() => void disconnect()}
          onCancel={() => setConfirmOff(false)}
        />
      )}
    </div>
  );
}
