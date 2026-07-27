"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { mediaUrl } from "@/lib/utils";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { IconBack, IconMapPin, IconTip, IconUser } from "./Icons";

/**
 * Guest-side chat header: the owner's profile. Shown as online unless the
 * creator flipped this chat's switch to "appear offline" — changes arrive
 * live over the chat's realtime channel.
 */
export default function GuestChatHeader({
  chatId,
  name,
  avatarPath,
  location,
  initialOnline = true,
}: {
  chatId?: string;
  name: string;
  avatarPath: string | null;
  location?: string | null;
  initialOnline?: boolean;
}) {
  const [online, setOnline] = useState(initialOnline);
  // Wallet bubble: keyed so a re-tap restarts the pop animation; balance is
  // null while it's still being fetched.
  const [bubble, setBubble] = useState<{ key: number; balance: number | null } | null>(
    null
  );

  async function showWalletBubble() {
    if (!chatId) return;
    const key = Date.now();
    setBubble({ key, balance: null });
    try {
      const res = await fetch(`/api/payments/wallet?chatId=${chatId}`);
      const data = await res.json();
      if (res.ok) {
        setBubble((b) =>
          b && b.key === key ? { key, balance: Number(data.balance ?? 0) } : b
        );
      }
    } catch {
      // Bubble just hides on its own if the fetch fails
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
    // z-40 so the wallet bubble hanging below the header stays above the
    // message list (which sits at z-30 and under)
    <header className="relative z-40 border-b border-line2 px-4 py-3 flex items-center gap-3 bg-card/60 backdrop-blur-lg">
      <Link
        href="/chats"
        aria-label="Back to chats"
        className="relative z-50 shrink-0 -ml-1 w-8 h-8 rounded-full flex items-center justify-center text-muted active:bg-card2"
      >
        <IconBack className="w-5 h-5" />
      </Link>
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
        <p className="font-bold text-[15px] leading-tight truncate">{name}</p>
        <div className="flex items-center gap-2">
          {/* Mobile keeps just the status dot; the text only shows on desktop */}
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
          aria-label="Show token balance"
          // z-50 keeps it clickable under the invisible owner corner button
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
          <span className="text-sm font-extrabold tabular-nums whitespace-nowrap">
            {bubble.balance === null ? "…" : bubble.balance.toLocaleString("en-US")}
            <span className="text-xs font-semibold text-muted"> Tokens</span>
          </span>
        </div>
      )}
    </header>
  );
}
