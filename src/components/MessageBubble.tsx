"use client";

import { mediaUrl, formatTime, URL_REGEX } from "@/lib/utils";
import { IconLock, IconReply, IconUnlock } from "./Icons";
import VideoPlayer from "./VideoPlayer";

export type Message = {
  id: string;
  chat_id: string;
  sender: "owner" | "guest";
  content: string | null;
  media_path: string | null;
  media_type: "image" | "video" | null;
  reply_to_id: string | null;
  locked?: boolean;
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
  onToggleLock,
}: {
  message: Message;
  mine: boolean;
  repliedTo: Message | null;
  onReply: (m: Message) => void;
  onLinkClick: (url: string) => void;
  onMediaClick: (m: Message) => void;
  onToggleLock: (m: Message) => void;
}) {
  const locked = !!message.locked;
  // Receiver of a locked message: blurred, unclickable
  const blurred = locked && !mine;

  const lockToggle = mine && message.media_path && (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggleLock(message);
      }}
      aria-label={locked ? "Unblur for them" : "Blur for them"}
      title={locked ? "Unblur for them" : "Blur for them"}
      className={`absolute top-2 right-2 z-10 w-8 h-8 rounded-full flex items-center justify-center backdrop-blur transition-colors ${
        locked ? "bg-accent text-white glow-accent" : "bg-black/50 text-white/90 hover:bg-black/70"
      }`}
    >
      {locked ? <IconLock className="w-4 h-4" /> : <IconUnlock className="w-4 h-4" />}
    </button>
  );

  const lockedOverlay = blurred && (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 pointer-events-none">
      <span className="w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center">
        <IconLock className="w-5 h-5 text-white" />
      </span>
      <span className="text-white text-xs font-semibold drop-shadow">Locked</span>
    </div>
  );

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
          <div className="relative overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaUrl(message.media_path)}
              alt={blurred ? "Locked photo" : "Photo"}
              className={`w-full max-h-80 object-cover ${
                blurred
                  ? "blur-2xl scale-110 pointer-events-none select-none"
                  : "cursor-pointer"
              }`}
              onClick={blurred ? undefined : () => onMediaClick(message)}
              draggable={false}
            />
            {lockedOverlay}
            {lockToggle}
          </div>
        )}
        {message.media_path && message.media_type === "video" && (
          <div className="relative overflow-hidden">
            {blurred ? (
              <video
                src={`${mediaUrl(message.media_path)}#t=0.001`}
                muted
                playsInline
                preload="metadata"
                className="w-full max-h-80 object-cover blur-2xl scale-110 pointer-events-none select-none"
              />
            ) : (
              <VideoPlayer
                src={mediaUrl(message.media_path)}
                videoClassName="max-h-80"
                fullscreenOnPlay
              />
            )}
            {lockedOverlay}
            {lockToggle}
          </div>
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
