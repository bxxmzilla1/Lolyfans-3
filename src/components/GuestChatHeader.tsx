"use client";

import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/lib/utils";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { IconMapPin, IconUser, IconVerified } from "./Icons";

/**
 * Guest-side chat header: the owner's profile. Shown as online unless the
 * creator flipped this chat's switch to "appear offline" — changes arrive
 * live over the chat's realtime channel.
 *
 * Wallet button opens the top-up sheet (single tap). The balance bubble is
 * no longer auto-shown from polls, and double-tap was removed so mobile
 * doesn't open the sheet twice.
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
  const openGuard = useRef(0);

  function openWalletSheet() {
    if (!chatId) return;
    // Ignore a second tap within 600ms (mobile ghost double-fires).
    const now = Date.now();
    if (now - openGuard.current < 600) return;
    openGuard.current = now;
    window.dispatchEvent(
      new CustomEvent("loly-open-wallet", { detail: { chatId } })
    );
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
      {chatId && (
        <button
          type="button"
          onClick={openWalletSheet}
          aria-label="Open wallet"
          className="relative z-50 ml-auto shrink-0 px-3.5 py-2 rounded-full bg-accent text-white text-xs font-semibold whitespace-nowrap active:opacity-80"
        >
          Wallet
        </button>
      )}
    </header>
  );
}
