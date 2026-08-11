"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { VaultPicker, type VaultItem } from "./MassMessage";
import OwnerDarkMode from "./OwnerDarkMode";
import Logo from "./Logo";
import { IconStar } from "./Icons";
import { mediaUrl, thumbUrl } from "@/lib/utils";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready: () => void;
        expand: () => void;
        close: () => void;
      };
    };
  }
}

type View = "loading" | "login" | "vault";

/**
 * Bot menu "Vault" Mini App: sign in with the Lolyfans account, pick a
 * vault item, set a Stars price — the bot posts the blurred forwardable
 * PPV bubble into the creator's bot chat.
 */
export default function VaultPpvMiniApp({ ownerId }: { ownerId: string }) {
  const [view, setView] = useState<View>("loading");
  const [initData, setInitData] = useState("");
  const [pick, setPick] = useState<VaultItem | null>(null);
  const [sentAt, setSentAt] = useState(0);

  // Telegram WebApp SDK → initData proves which bot chat to post into.
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.async = true;
    script.onload = () => {
      const wa = window.Telegram?.WebApp;
      wa?.ready();
      wa?.expand();
      setInitData(wa?.initData || "");
    };
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);

  // Session probe: any owner-authed API tells us if they're signed in.
  useEffect(() => {
    fetch("/api/vault/albums")
      .then((res) => setView(res.ok ? "vault" : "login"))
      .catch(() => setView("login"));
  }, []);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <OwnerDarkMode />

      {view === "loading" && (
        <div className="min-h-dvh flex items-center justify-center text-muted text-sm">
          Opening your vault…
        </div>
      )}

      {view === "login" && <MiniLogin onDone={() => setView("vault")} />}

      {view === "vault" && (
        <div className="relative h-dvh">
          <VaultPicker
            onPick={(item) => setPick(item)}
            onClose={() => window.Telegram?.WebApp?.close()}
          />
          {pick && (
            <PriceSheet
              ownerId={ownerId}
              item={pick}
              initData={initData}
              onClose={() => setPick(null)}
              onSent={() => {
                setPick(null);
                setSentAt(Date.now());
              }}
            />
          )}
          {sentAt > 0 && (
            <SentToast key={sentAt} onGone={() => setSentAt(0)} />
          )}
        </div>
      )}
    </div>
  );
}

function MiniLogin({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const { error } = await supabaseBrowser().auth.signInWithPassword({
      email,
      password,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    onDone();
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-3">
        <Logo className="w-16 h-16 glow-accent" />
        <h1 className="text-2xl font-bold ig-gradient-text">LolyFans</h1>
        <p className="text-muted text-sm text-center">
          Sign in to open your vault and send Stars PPVs from the bot.
        </p>
      </div>
      <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="email"
          required
          className="w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent transition-colors"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          required
          className="w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent transition-colors"
        />
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        <button
          type="submit"
          disabled={busy || !email || !password}
          className="w-full bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-40"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function PriceSheet({
  ownerId,
  item,
  initData,
  onClose,
  onSent,
}: {
  ownerId: string;
  item: VaultItem;
  initData: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [stars, setStars] = useState("50");
  const [caption, setCaption] = useState("");
  const [linkText, setLinkText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const priceStars = Math.round(Number(stars)) || 0;

  // Prefill the pay-link text with what was saved from the last PPV.
  useEffect(() => {
    fetch("/api/stars/ppv")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.linkText) setLinkText(data.linkText);
      })
      .catch(() => {});
  }, []);

  async function send() {
    if (busy || priceStars < 1) return;
    if (!initData) {
      setError("Open this page from your bot's Vault button in Telegram");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/stars/ppv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerId,
          initData,
          mediaPath: item.media_path,
          mediaType: item.media_type,
          priceStars,
          caption: caption.trim(),
          linkText: linkText.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not send the PPV");
        return;
      }
      onSent();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-20 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full max-w-md bg-card border border-line rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[90dvh] flex flex-col">
        <header className="px-4 py-3 border-b border-line flex items-center justify-between">
          <p className="font-bold flex items-center gap-2">
            <IconStar className="w-4 h-4 text-amber-400" />
            Send as Stars PPV
          </p>
          <button type="button" onClick={onClose} className="text-muted text-sm">
            Cancel
          </button>
        </header>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="rounded-xl overflow-hidden border border-line">
            {item.media_type === "video" ? (
              // Playable preview — tap to watch before pricing it.
              <video
                src={`${mediaUrl(item.media_path)}#t=0.001`}
                className="w-full max-h-64 object-contain bg-black"
                controls
                playsInline
                preload="metadata"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbUrl(item.media_path)}
                alt=""
                className="w-full max-h-48 object-cover"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold">
              Price in Stars <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              min={1}
              value={stars}
              onChange={(e) => setStars(e.target.value)}
              className="w-full rounded-xl border border-line bg-card2 px-3.5 py-2.5 text-sm outline-none focus:border-amber-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold">
              Pay link text (shown bold under the blurred media)
            </label>
            <input
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              maxLength={120}
              placeholder="⭐ Unlock for {price} Stars"
              className="w-full rounded-xl border border-line bg-card2 px-3.5 py-2.5 text-sm outline-none focus:border-amber-500"
            />
            <p className="text-[11px] text-muted">
              {"{price}"} becomes the Stars amount. Saved for future PPVs.
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold">Caption (optional)</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={2}
              maxLength={300}
              className="w-full rounded-xl border border-line bg-card2 px-3.5 py-2.5 text-sm outline-none focus:border-accent resize-none"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || priceStars < 1}
            className="w-full rounded-xl bg-amber-500 text-black font-bold py-3 text-sm disabled:opacity-50"
          >
            {busy ? "Sending…" : `Send to bot chat · ${priceStars} Stars`}
          </button>
        </div>
      </div>
    </div>
  );
}

function SentToast({ onGone }: { onGone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onGone, 3500);
    return () => clearTimeout(t);
  }, [onGone]);
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-6 z-30 bg-card border border-amber-500/40 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg flex items-center gap-2">
      <IconStar className="w-4 h-4 text-amber-400" />
      PPV sent — check your bot chat and forward it
    </div>
  );
}
