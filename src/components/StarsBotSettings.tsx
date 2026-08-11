"use client";

import { useEffect, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { IconCheck, IconStar } from "./Icons";

/**
 * Settings → Stars PPV bot: connect a BotFather bot. You DM it a photo or
 * video, set a Stars price, and it replies with a forwardable invoice.
 * When a fan pays, the bot hands you the unlocked media + who to forward
 * it to.
 */
export default function StarsBotSettings() {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [botLink, setBotLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  async function load() {
    const res = await fetch("/api/telegram/bot").catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setBotUsername(data.botUsername ?? null);
      setBotLink(data.botLink ?? null);
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
      setBotLink(data.botLink ?? null);
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
    setBotLink(null);
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
          Stars PPV bot
        </p>
        <p className="text-xs text-muted mt-0.5">
          Connect a bot from @BotFather. Its <b className="text-fg">Vault</b>{" "}
          menu button opens a Mini App where you sign in with your Lolyfans
          account, pick a vault photo or video, and set a price in{" "}
          <span className="text-fg font-semibold">Telegram Stars</span> — the
          blurred PPV lands in your bot chat ready to forward. When a fan
          pays, the bot sends you the unlocked media and who to forward it
          to. Earnings go to your bot&apos;s Stars balance.
        </p>
      </div>

      {botUsername ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-200">
            Connected · @{botUsername}
          </p>
          {botLink && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Your bot
              </p>
              <input
                readOnly
                value={botLink}
                className="w-full bg-card border border-line rounded-xl px-3 py-2 text-sm"
                onFocus={(e) => e.target.select()}
              />
            </div>
          )}
          <ol className="text-xs text-muted list-decimal pl-4 space-y-1">
            <li>
              Open the bot on Telegram — tap the <b className="text-fg">Vault</b>{" "}
              menu button and sign in with your Lolyfans account
            </li>
            <li>
              Pick a photo or video from your vault and enter the Stars
              price — the blurred PPV appears in the bot chat
            </li>
            <li>Forward that PPV bubble to any fan</li>
            <li>
              After they pay, the bot sends you the unlocked media + their
              name — forward it to them
            </li>
            <li>
              You can also DM media straight to the bot (first time it asks
              for the activation code <b className="text-fg">242124</b>)
            </li>
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
            We set up the webhook automatically.
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
          message="The bot will stop making PPVs and taking Stars payments until you connect one again."
          onConfirm={() => void disconnect()}
          onCancel={() => setConfirmOff(false)}
        />
      )}
    </div>
  );
}
