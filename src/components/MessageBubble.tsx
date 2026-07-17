"use client";

import { mediaUrl, formatTime, URL_REGEX } from "@/lib/utils";
import { IconReply } from "./Icons";
import VideoPlayer from "./VideoPlayer";

export type Message = {
  id: string;
  chat_id: string;
  sender: "owner" | "guest";
  content: string | null;
  media_path: string | null;
  media_type: "image" | "video" | null;
  reply_to_id: string | null;
  created_at: string;
};

function renderContent(text: string, onLinkClick: (url: string) => void) {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <button
        key={i}
        onClick={(e) => {
          e.stopPropagation();
          onLinkClick(part);
        }}
        className="underline break-all text-left font-medium opacity-95 hover:opacity-100"
      >
        {part}
      </button>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function MessageBubble({
  message,
  mine,
  repliedTo,
  onReply,
  onLinkClick,
  onMediaClick,
}: {
  message: Message;
  mine: boolean;
  repliedTo: Message | null;
  onReply: (m: Message) => void;
  onLinkClick: (url: string) => void;
  onMediaClick: (m: Message) => void;
}) {
  return (
    <div className={`group msg-in flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
      <div
        className={`max-w-[78%] rounded-3xl overflow-hidden ${
          mine ? "bubble-own rounded-br-lg" : "bg-card2 rounded-bl-lg"
        }`}
      >
        {repliedTo && (
          <div className={`mx-3 mt-2 px-3 py-1.5 rounded-xl text-xs border-l-2 ${
            mine ? "bg-white/15 border-white/60 text-white/85" : "bg-line/60 border-accent text-muted"
          }`}>
            <p className="font-semibold mb-0.5">
              {repliedTo.sender === message.sender ? "Replying to self" : "Reply"}
            </p>
            <p className="truncate">
              {repliedTo.content ||
                (repliedTo.media_type === "image" ? "Photo" : "Video")}
            </p>
          </div>
        )}

        {message.media_path && message.media_type === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl(message.media_path)}
            alt="Photo"
            className="w-full max-h-80 object-cover cursor-pointer"
            onClick={() => onMediaClick(message)}
          />
        )}
        {message.media_path && message.media_type === "video" && (
          <VideoPlayer
            src={mediaUrl(message.media_path)}
            videoClassName="max-h-80"
          />
        )}

        {message.content && (
          <p className="px-4 py-2.5 text-[15px] leading-snug whitespace-pre-wrap break-words">
            {renderContent(message.content, onLinkClick)}
          </p>
        )}

        <p
          className={`px-4 pb-1.5 text-[10px] ${
            mine ? "text-white/60 text-right" : "text-muted"
          } ${!message.content && message.media_path ? "pt-1.5" : "-mt-1"}`}
        >
          {formatTime(message.created_at)}
        </p>
      </div>

      <button
        onClick={() => onReply(message)}
        className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100 transition-opacity text-muted hover:text-fg p-1.5 shrink-0"
        aria-label="Reply"
        title="Reply"
      >
        <IconReply className="w-4 h-4" />
      </button>
    </div>
  );
}
