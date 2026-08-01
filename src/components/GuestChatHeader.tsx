"use client";

import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/lib/utils";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { IconMapPin, IconTip, IconUser, IconVerified } from "./Icons";

/**
 * Guest-side chat header: the owner's profile. Shown as online unless the
 * creator flipped this chat's switch to "appear offline" — changes arrive
 * live over the chat's realtime channel.
 *
 * Wallet button shows a self-hiding token-balance bubble on tap only.
 * Double-tap opens the full wallet sheet via event.
 */
export default function GuestChatHeader({
  chatId,
  name,
  avatarPath,
  location,
  verified = false,
  initialOnline = true,
}: {
  chatId?: string;
  name: string;
  avatarPath: string | null;
  location?: string | null;
  verified?: boolean;
  initialOnline?: boolean;
}) {
  const [online, setOnline] = useState(initialOnline);
  const [bubble, setBubble] = useState<{
    key: number;
    balance: number | null;
  } | null>(null);
  // Quiet cache from ChatView's wallet poll — never auto-opens the bubble.
  const balanceCache = useRef<number | null>(null);

  async function showWalletBubble() {
    if (!chatId) return;
    const key = Date.now();
    setBubble({ key, balance: balanceCache.current });
    try {
      const res = await fetch(`/api/payments/wallet?chatId=${chatId}`);
      const data = await res.json();
      if (res.ok) {
        const bal = Number(data.balance ?? 0);
        balanceCache.current = bal;
        const slow = Date.now() - key > 800;
        setBubble((b) =>
          b && b.key === key
            ? { key: slow ? Date.now() : key, balance: bal }
            : b
        );
      }
    } catch {
      // Bubble hides on its own if the fetch fails
    }
  }

  useEffect(() => {
    if (!chatId) return;
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`chat:${chatId}`)
      .on("broadcast", { event: "owner-presence" }, ({ payload }) => {
        const p = payload as { online?: boolean } | null;
        if (typeof p?.online === "boolean") setOnline(p.online);
      });
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId]);

  useEffect(() => {
    function onWallet(e: Event) {
      const d = (e as CustomEvent).detail as { balance?: number } | null;
      // Cache only — the bubble is tap-to-reveal, never auto-pop from polls.
      if (typeof d?.balance === "number") balanceCache.current = d.balance;
    }
    window.addEventListener("loly-wallet", onWallet);
    return () => window.removeEventListener("loly-wallet", onWallet);
  }, []);

  return (
    <header className="relative z-40 border-b border-line2 px-4 py-3 flex items-center gap-3 bg-card/60 backdrop-blur-lg">
      <div className="relative shrink-0">
        <div className="ig-ring">
          {avatarPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl(avatarPath)}
              alt={name}
              className="w-10 h-10 rounded-full object-cover bg-bg"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center">
              <IconUser className="w-5 h-5 text-muted" />
            </div>
          )}
        </div>
        <span
          className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-bg ${
            online ? "bg-green-500" : "bg-gray-400"
          }`}
        />
      </div>
      <div className="min-w-0">
        <p className="font-bold text-[15px] leading-tight flex items-center gap-1">
          <span className="truncate">{name}</span>
          {verified && (
            <span className="flex items-center gap-0.5 shrink-0">
              <IconVerified className="w-4 h-4 text-sky-500" />
              <span className="text-[10px] font-semibold text-sky-500">
                ID Verified
              </span>
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <p
            className={`hidden lg:block text-xs ${
              online ? "text-green-400" : "text-muted"
            }`}
          >
            {online ? "Online Now" : "Offline"}
          </p>
          {location && (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted truncate">
              <IconMapPin className="w-3 h-3 text-accent shrink-0" />
              {location}
            </span>
          )}
        </div>
      </div>
      {chatId && (
        <button
          type="button"
          onClick={showWalletBubble}
          onDoubleClick={() =>
            window.dispatchEvent(new CustomEvent("loly-open-wallet"))
          }
          aria-label="Show token balance"
          className="relative z-50 ml-auto shrink-0 px-3.5 py-2 rounded-full bg-accent text-white text-xs font-semibold whitespace-nowrap active:opacity-80"
        >
          Wallet
        </button>
      )}
      {bubble && (
        <div
          key={bubble.key}
          onAnimationEnd={() => setBubble(null)}
          className="wallet-bubble absolute right-3 top-full mt-2 z-50 pointer-events-none rounded-2xl rounded-tr-sm bg-card border border-line shadow-lg px-3.5 py-2 flex items-center gap-2"
        >
          <span className="w-6 h-6 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <IconTip className="w-4 h-4" />
          </span>
          {bubble.balance === null ? (
            <span
              className="flex items-center gap-1 px-1 py-2"
              aria-label="Loading balance"
            >
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent" />
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent" />
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent" />
            </span>
          ) : (
            <span className="text-sm font-extrabold tabular-nums whitespace-nowrap">
              {bubble.balance.toLocaleString("en-US")}
              <span className="text-xs font-semibold text-muted"> Tokens</span>
            </span>
          )}
        </div>
      )}
    </header>
  );
}
