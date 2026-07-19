"use client";

import { mediaUrl, formatTime, messagePreviewText, firstLinkIn, linkPriceIn } from "@/lib/utils";
import { IconCheck, IconEyeOff, IconLink, IconLock, IconReply, IconUnlock } from "./Icons";
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
  hidden?: boolean;
  created_at: string;
};

/**
 * Attached links ("[Payment Link]{25}(https://…)") show their label — or the
 * URL itself when no label was given. Only on LOCKED media does an unlabeled
 * link disappear entirely (the blurred media is the tap target, price rides
 * on the Locked badge). Bare URLs show as-is. Everything opens in a new tab.
 */
const LINK_TOKEN_REGEX =
  /\[([^\]\n]{0,200})\](?:\{([^}\n]{1,20})\})?\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')\]]+)/g;

function renderContent(
  text: string,
  mine: boolean,
  hasMedia: boolean,
  locked: boolean
) {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(LINK_TOKEN_REGEX)) {
    const index = match.index ?? 0;
    const isAttached = match[3] !== undefined;
    const label = match[1];
    const price = match[2];
    const url = match[3] ?? match[4];
    const hidden = isAttached && !label && hasMedia && locked;
    if (index > last) {
      const segment = text.slice(last, index);
      // Don't leave a dangling blank line where a hidden link was.
      nodes.push(<span key={key++}>{hidden ? segment.replace(/\s+$/, "") : segment}</span>);
    }
    if (hidden) {
      // Hidden link on locked media: the media opens it, nothing shows here.
    } else if (isAttached) {
      nodes.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          // Blue label; on the own (blue) bubble white stays readable
          className={`inline-flex items-center gap-1 align-middle underline font-semibold ${
            mine ? "text-white" : "text-accent"
          }`}
        >
          <IconLink className="w-4 h-4 shrink-0" />
          <span className="break-all">{label || url}</span>
          {price && !(hasMedia && locked) && (
            <span className="shrink-0">· ${price}</span>
          )}
        </a>
      );
    } else {
      nodes.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="underline break-all font-medium opacity-95 hover:opacity-100"
        >
          {url}
        </a>
      );
    }
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(<span key={key++}>{text.slice(last)}</span>);
  return nodes;
}

export default function MessageBubble({
  message,
  mine,
  repliedTo,
  onReply,
  onMediaClick,
  onToggleLock,
  selectMode = false,
  selected = false,
  onSelectToggle,
}: {
  message: Message;
  mine: boolean;
  repliedTo: Message | null;
  onReply: (m: Message) => void;
  onMediaClick: (m: Message) => void;
  onToggleLock: (m: Message) => void;
  selectMode?: boolean;
  selected?: boolean;
  onSelectToggle?: (m: Message) => void;
}) {
  const locked = !!message.locked;
  // Receiver of a locked message: blurred, unclickable
  const blurred = locked && !mine;
  // Locked media with a link attached: tapping the blurred preview opens the
  // link (e.g. a payment page) in a new tab.
  const blurredLink = blurred && message.content ? firstLinkIn(message.content) : null;
  const blurredPrice = blurred && message.content ? linkPriceIn(message.content) : null;
  // Creator's own bubble: the attached price shows tiny in the bottom corner.
  const myPrice = mine && message.content ? linkPriceIn(message.content) : null;
  // A locked media message whose content is only a hidden link renders no text row.
  const showText =
    !!message.content &&
    !(message.media_path && locked && messagePreviewText(message.content) === "");

  const lockToggle = mine && message.media_path && (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggleLock(message);
      }}
      aria-label={locked ? "Unblur for them" : "Blur for them"}
      title={locked ? "Unblur for them" : "Blur for them"}
      className={`absolute top-2 right-2 z-10 w-8 h-8 rounded-full hidden lg:flex items-center justify-center backdrop-blur transition-colors ${
        locked ? "bg-accent text-white glow-accent" : "bg-black/50 text-white/90 hover:bg-black/70"
      }`}
    >
      {locked ? <IconLock className="w-4 h-4" /> : <IconUnlock className="w-4 h-4" />}
    </button>
  );

  const lockedOverlay = blurred && (
    <>
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 pointer-events-none">
        <span className="w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center">
          <IconLock className="w-5 h-5 text-white" />
        </span>
        <span className="text-white text-xs font-semibold drop-shadow">Locked</span>
        {blurredPrice && (
          <span className="text-white text-sm font-bold drop-shadow">{`$${blurredPrice}`}</span>
        )}
      </div>
      {/* A link came with the locked media → the blurred preview is a tap
          target that opens it in a new tab */}
      {blurredLink && (
        <a
          href={blurredLink}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label="Open link"
          className="absolute inset-0 z-[15] cursor-pointer"
        />
      )}
    </>
  );

  return (
    <div className={`group msg-in flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
      <div
        className={`relative max-w-[78%] rounded-3xl overflow-hidden ${
          mine ? "bubble-own rounded-br-lg" : "bg-card2 rounded-bl-lg"
        } ${message.hidden ? "opacity-60" : ""} ${
          selectMode && selected ? "ring-2 ring-accent" : ""
        }`}
      >
        {message.hidden && (
          <div className="px-3 pt-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                mine ? "bg-white/20 text-white" : "bg-line text-muted"
              }`}
            >
              <IconEyeOff className="w-3 h-3" /> Hidden
            </span>
          </div>
        )}
        {selectMode && (
          <button
            onClick={() => onSelectToggle?.(message)}
            aria-label={selected ? "Unselect message" : "Select message"}
            className="absolute inset-0 z-20 cursor-pointer"
          >
            <span
              className={`absolute top-2 ${mine ? "left-2" : "right-2"} w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                selected ? "bg-accent border-accent" : "bg-black/40 border-white/70"
              }`}
            >
              {selected && <IconCheck className="w-3 h-3 text-white" />}
            </span>
          </button>
        )}
        {repliedTo && (
          <div className={`mx-3 mt-2 px-3 py-1.5 rounded-xl text-xs border-l-2 ${
            mine ? "bg-white/15 border-white/60 text-white/85" : "bg-line/60 border-accent text-muted"
          }`}>
            <p className="font-semibold mb-0.5">
              {repliedTo.sender === message.sender ? "Replying to self" : "Reply"}
            </p>
            <p className="truncate">
              {(repliedTo.content && messagePreviewText(repliedTo.content)) ||
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

        {showText && message.content && (
          <p className="px-4 py-2.5 text-[15px] leading-snug whitespace-pre-wrap break-words">
            {renderContent(message.content, mine, !!message.media_path, locked)}
          </p>
        )}

        <p
          className={`px-4 pb-1.5 text-[10px] flex items-center gap-2 ${
            mine ? "text-white/60 justify-end" : "text-muted"
          } ${!showText && message.media_path ? "pt-1.5" : "-mt-1"}`}
        >
          {myPrice && (
            <span className="mr-auto font-semibold">{`$${myPrice}`}</span>
          )}
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
