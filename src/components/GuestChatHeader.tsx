"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { mediaUrl } from "@/lib/utils";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { IconMapPin, IconPhone, IconTip, IconUser, IconVerified } from "./Icons";

/**
 * Guest-side chat header: the owner's profile. Shown as online unless the
 * creator flipped this chat's switch to "appear offline" — changes arrive
 * live over the chat's realtime channel.
 *
 * Wallet button: tap shows a self-hiding bubble with a loading animation,
 * then the token balance. It does not open the pack sheet.
 */
export default function GuestChatHeader({
  chatId,
  name,
  avatarPath,
  location,
  verified = false,
  initialOnline = true,
  callHref,
}: {
  chatId?: string;
  name: string;
  avatarPath: string | null;
  location?: string | null;
  verified?: boolean;
  initialOnline?: boolean;
  /** Link to the voice-call page (shown as a phone button when set). */
  callHref?: string;
}) {
  const [online, setOnline] = useState(initialOnline);
  const [bubble, setBubble] = useState<{
    key: number;
    balance: number | null;
  } | null>(null);
  const tapGuard = useRef(0);

  async function showWalletBubble() {
    if (!chatId) return;
    const now = Date.now();
    if (now - tapGuard.current < 600) return;
    tapGuard.current = now;

    const key = Date.now();
    setBubble({ key, balance: null });
    try {
      const res = await fetch(`/api/payments/wallet?chatId=${chatId}`);
      const data = await res.json();
      if (res.ok) {
        // Slow fetch: restart the pop so the number gets a full display window.
        const slow = Date.now() - key > 800;
        setBubble((b) =>
          b && b.key === key
            ? {
                key: slow ? Date.now() : key,
                balance: Number(data.balance ?? 0),
              }
            : b
        );
      } else {
        setBubble(null);
      }
    } catch {
      setBubble(null);
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
      <span className="ml-auto" />
      {callHref && (
        <Link
          href={callHref}
          aria-label={`Call ${name}`}
          title="Voice call · $1/min"
          className="shrink-0 w-10 h-10 rounded-full bg-green-500/15 text-green-400 hover:bg-green-500/25 flex items-center justify-center transition-colors"
        >
          <IconPhone className="w-5 h-5" />
        </Link>
      )}
      {chatId && (
        <button
          type="button"
          onClick={showWalletBubble}
          aria-label="Show token balance"
          className="relative z-50 shrink-0 px-3.5 py-2 rounded-full bg-accent text-white text-xs font-semibold whitespace-nowrap active:opacity-80"
        >
          My Tokens
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
