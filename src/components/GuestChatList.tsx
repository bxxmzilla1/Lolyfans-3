"use client";

import { useState } from "react";
import { mediaUrl, formatTime } from "@/lib/utils";
import { useNavigate } from "@/lib/navPending";
import type { GuestChatRow } from "@/lib/guestBootstrapCache";
import { IconUser, IconVerified } from "./Icons";

/**
 * The fan's conversations — one per creator they subscribed to or follow.
 * Tapping a row points the session at that chat and opens it.
 */
export default function GuestChatList({ chats }: { chats: GuestChatRow[] }) {
  const { run } = useNavigate();
  const [opening, setOpening] = useState<string | null>(null);

  async function open(chat: GuestChatRow) {
    if (opening) return;
    setOpening(chat.id);
    await run(async () => {
      try {
        const res = await fetch("/api/guest/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: chat.id }),
        });
        if (res.ok) return "/chat";
      } catch {
        // fall through
      }
      return null;
    });
    setOpening(null);
  }

  if (chats.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="font-semibold mb-1">No chats yet</p>
        <p className="text-sm text-muted">
          Subscribe to a creator to start a conversation.
        </p>
      </div>
    );
  }

  const sorted = [...chats].sort(
    (a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt)
  );

  return (
    <ul className="divide-y divide-line2">
      {sorted.map((chat) => (
        <li key={chat.id}>
          <button
            type="button"
            onClick={() => open(chat)}
            disabled={!!opening}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-card2 transition-colors ${
              opening === chat.id ? "opacity-60" : ""
            }`}
          >
            <div className="ig-ring shrink-0">
              {chat.ownerAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(chat.ownerAvatar)}
                  alt={chat.ownerName}
                  className="w-12 h-12 rounded-full object-cover bg-bg"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-bg flex items-center justify-center">
                  <IconUser className="w-6 h-6 text-muted" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-[15px] truncate flex items-center gap-1">
                  <span className="truncate">{chat.ownerName}</span>
                  <IconVerified className="w-5 h-5 text-accent shrink-0" />
                </p>
                <span className="ml-auto text-[11px] text-muted shrink-0">
                  {formatTime(chat.lastMessageAt)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <p
                  className={`text-sm truncate ${
                    chat.unread > 0 ? "text-fg font-medium" : "text-muted"
                  }`}
                >
                  {chat.preview}
                </p>
                {chat.unread > 0 && (
                  <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-accent text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    {chat.unread > 99 ? "99+" : chat.unread}
                  </span>
                )}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
