"use client";

import { useEffect, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

type ApiKey = {
  token: string;
  created_at: string;
  last_used_at: string | null;
};

/**
 * Settings tab that manages the owner's API key. External apps (like the Orion
 * chatbot) use this key to read all chats and auto-respond on the owner's behalf.
 */
export default function ApiKeyManager() {
  const [key, setKey] = useState<ApiKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/apikey");
    const data = await res.json().catch(() => null);
    setKey(data?.key ?? null);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function generate() {
    setWorking(true);
    const res = await fetch("/api/apikey", { method: "POST" });
    const data = await res.json().catch(() => null);
    if (data?.key) setKey(data.key);
    setWorking(false);
    setConfirmRegen(false);
  }

  async function revoke() {
    setWorking(true);
    await fetch("/api/apikey", { method: "DELETE" });
    setKey(null);
    setWorking(false);
    setConfirmRevoke(false);
  }

  async function copy() {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; the field is selectable as a fallback
    }
  }

  const appUrl =
    typeof window !== "undefined" ? window.location.origin : "https://your-app.vercel.app";

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold">API Key</h2>
        <p className="text-muted text-sm mt-1">
          Connect Orion (your AI chatbot) to Lolyfans. Orion uses this key to
          fetch all your chats and auto-respond to your fans for you.
        </p>
      </div>

      {loading ? (
        <div className="h-24 rounded-xl bg-card2 border border-line animate-pulse" />
      ) : key ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold">Your API key</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={key.token}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 bg-card2 border border-line2 rounded-xl px-3 py-2.5 text-sm font-mono"
              />
              <button
                onClick={copy}
                className="shrink-0 bg-accent text-white font-semibold rounded-xl px-4 text-sm active:opacity-80 transition-opacity"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-muted text-xs">
              Created {new Date(key.created_at).toLocaleString()}
              {key.last_used_at
                ? ` · last used ${new Date(key.last_used_at).toLocaleString()}`
                : " · not used yet"}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setConfirmRegen(true)}
              disabled={working}
              className="bg-card2 border border-line rounded-xl px-4 py-2.5 text-sm font-semibold hover:text-fg disabled:opacity-50"
            >
              Regenerate
            </button>
            <button
              onClick={() => setConfirmRevoke(true)}
              disabled={working}
              className="bg-card2 border border-line rounded-xl px-4 py-2.5 text-sm font-semibold text-red-400 hover:bg-card disabled:opacity-50"
            >
              Revoke
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={generate}
          disabled={working}
          className="w-full bg-accent text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
        >
          {working ? "Generating…" : "Generate API key"}
        </button>
      )}

      <div className="rounded-xl bg-card2 border border-line p-4 space-y-2">
        <p className="text-sm font-semibold">How to connect Orion</p>
        <ol className="text-muted text-sm space-y-1.5 list-decimal list-inside">
          <li>Copy the API key above.</li>
          <li>Open Orion → Settings → Lolyfans integration.</li>
          <li>
            Paste this app&apos;s URL{" "}
            <span className="font-mono text-fg break-all">{appUrl}</span> and the
            API key.
          </li>
          <li>Turn on auto-respond. Orion will fetch your chats and reply for you.</li>
        </ol>
      </div>

      {confirmRegen && (
        <ConfirmDialog
          title="Regenerate API key?"
          message="The current key stops working immediately. You'll need to paste the new key into Orion."
          confirmLabel="Regenerate"
          onConfirm={generate}
          onCancel={() => setConfirmRegen(false)}
        />
      )}
      {confirmRevoke && (
        <ConfirmDialog
          title="Revoke API key?"
          message="Orion will lose access to your chats until you generate a new key."
          confirmLabel="Revoke"
          onConfirm={revoke}
          onCancel={() => setConfirmRevoke(false)}
        />
      )}
    </div>
  );
}
