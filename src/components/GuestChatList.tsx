"use client";

import { useRouter } from "next/navigation";
import { mediaUrl, formatTime } from "@/lib/utils";
import { IconUser, IconVerified } from "./Icons";

export type GuestChatRow = {
  id: string;
  ownerName: string;
  ownerAvatar: string | null;
  verified: boolean;
  preview: string;
  lastMessageAt: string;
  unread: number;
};

/** The guest's conversations; tapping one opens it in the chat page. */
export default function GuestChatList({ chats }: { chats: GuestChatRow[] }) {
  const router = useRouter();

  async function open(chatId: string) {
    // Point the guest session at this chat, then open it.
    await fetch("/api/guest/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
    });
    router.push("/chat");
  }

  return (
    <ul className="divide-y divide-line">
      {chats.map((chat) => (
        <li key={chat.id}>
          <button
            onClick={() => open(chat.id)}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-card2 transition-colors"
          >
            <div className="relative shrink-0">
              {chat.ownerAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(chat.ownerAvatar)}
                  alt={chat.ownerName}
                  className="w-12 h-12 rounded-full object-cover bg-card2"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-card2 flex items-center justify-center">
                  <IconUser className="w-6 h-6 text-muted" />
                </div>
              )}
              <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-bg bg-green-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[15px] truncate flex items-center gap-1">
                {chat.ownerName}
                {chat.verified && <IconVerified className="w-4 h-4 text-sky-500 shrink-0" />}
              </p>
              <p
                className={`text-sm truncate ${
                  chat.unread > 0 ? "text-fg font-medium" : "text-muted"
                }`}
              >
                {chat.preview}
              </p>
            </div>
            <div className="shrink-0 flex flex-col items-end gap-1.5">
              <span className="text-[11px] text-muted">{formatTime(chat.lastMessageAt)}</span>
              {chat.unread > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-white text-[11px] font-bold flex items-center justify-center">
                  {chat.unread > 99 ? "99+" : chat.unread}
                </span>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
