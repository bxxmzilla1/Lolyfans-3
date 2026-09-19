"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { mediaUrl } from "@/lib/utils";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useNavigate } from "@/lib/navPending";
import { IconBack, IconPhone, IconUser, IconVerified } from "./Icons";

/**
 * Guest-side chat header: the owner's profile with an online / offline
 * status. Shown as online unless the creator flipped this chat's switch to
 * "appear offline" — changes arrive live over the chat's realtime channel.
 */
export default function GuestChatHeader({
  chatId,
  name,
  avatarPath,
  verified = false,
  initialOnline = true,
  callHref,
  backHref,
}: {
  chatId?: string;
  name: string;
  avatarPath: string | null;
  verified?: boolean;
  initialOnline?: boolean;
  /** Link to the voice-call page (shown as a phone button when set). */
  callHref?: string;
  /** Back arrow to the fan's chat list (fans with several creators). */
  backHref?: string;
}) {
  const [online, setOnline] = useState(initialOnline);
  const { go } = useNavigate();

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
      {backHref && (
        <button
          type="button"
          onClick={() => go(backHref)}
          aria-label="All chats"
          className="shrink-0 -ml-2 w-9 h-9 rounded-full hover:bg-card2 flex items-center justify-center text-fg transition-colors"
        >
          <IconBack className="w-6 h-6" />
        </button>
      )}
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
        <p
          className={`flex items-center gap-1.5 text-xs ${
            online ? "text-green-400" : "text-muted"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${online ? "bg-green-400" : "bg-gray-400"}`}
          />
          {online ? "Online now" : "Offline"}
        </p>
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
    </header>
  );
}
