"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { formatTime } from "@/lib/utils";
import { IconLink } from "./Icons";

type ChatRow = {
  id: string;
  guest_name: string;
  guest_country: string | null;
  last_message_at: string;
  invites: { label: string | null; code: string } | null;
  preview: { content: string | null; media_type: string | null } | null;
  unread: number;
};

function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return "";
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

// Module-level cache: navigating between pages re-mounts the list,
// so start from the last known data instead of a loading skeleton.
let chatsCache: ChatRow[] | null = null;
let ownerIdCache: string | null = null;

export default function ChatList() {
  const [chats, setChats] = useState<ChatRow[] | null>(chatsCache);
  const [ownerId, setOwnerId] = useState<string | null>(ownerIdCache);
  const pathname = usePathname();
  const cancelledRef = useRef(false);

  async function load() {
    const res = await fetch("/api/chats");
    if (res.ok && !cancelledRef.current) {
      const { chats, ownerId } = await res.json();
      chatsCache = chats;
      ownerIdCache = ownerId;
      setChats(chats);
      setOwnerId(ownerId);
    }
  }

  // Refetch on mount and on navigation (opening a chat clears its badge server-side).
  useEffect(() => {
    cancelledRef.current = false;
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Instant updates: every new message broadcasts to the owner's inbox channel.
  useEffect(() => {
    if (!ownerId) return;
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`inbox:${ownerId}`)
      .on("broadcast", { event: "new-message" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  if (chats === null) {
    return (
      <div className="p-4 space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 animate-pulse">
            <div className="w-12 h-12 rounded-full bg-card2" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-card2 rounded w-1/3" />
              <div className="h-3 bg-card2 rounded w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="p-8 text-center flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-2xl ig-gradient glow-accent flex items-center justify-center">
          <IconLink className="w-6 h-6 text-white" />
        </div>
        <p className="font-semibold">No chats yet</p>
        <p className="text-muted text-sm">
          Create an invite link and share it — anyone who opens it can chat
          with you instantly.
        </p>
        <Link
          href="/invites"
          className="mt-2 bg-accent text-white font-semibold text-sm rounded-xl px-5 py-2.5"
        >
          Create invite link
        </Link>
      </div>
    );
  }

  return (
    <ul className="px-2 space-y-0.5">
      {chats.map((chat) => {
        const active = pathname === `/inbox/${chat.id}`;
        return (
          <li key={chat.id}>
            <Link
              href={`/inbox/${chat.id}`}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                active ? "bg-accent/15" : "hover:bg-card2/70"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-1 rounded-full bg-accent" />
              )}
              <div className="ig-ring shrink-0">
                <div className="w-11 h-11 rounded-full bg-bg flex items-center justify-center text-base font-bold uppercase">
                  {chat.guest_name.slice(0, 1)}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[14px] flex items-center gap-1.5 ${
                  chat.unread > 0 && !active ? "font-bold" : "font-semibold"
                }`}>
                  {chat.guest_name}
                  <span className="text-xs">{countryFlag(chat.guest_country)}</span>
                </p>
                <p className={`text-[13px] truncate ${
                  chat.unread > 0 && !active ? "text-fg font-medium" : "text-muted"
                }`}>
                  {chat.preview?.content ||
                    (chat.preview?.media_type === "image"
                      ? "Photo"
                      : chat.preview?.media_type === "video"
                      ? "Video"
                      : "New chat")}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-muted text-[11px]">
                  {formatTime(chat.last_message_at)}
                </span>
                {chat.unread > 0 && !active && (
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent text-white text-[11px] font-bold flex items-center justify-center fade-up">
                    {chat.unread > 99 ? "99+" : chat.unread}
                  </span>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
