"use client";

import { useEffect, useState } from "react";
import {
  mediaUrl,
  formatTime,
  messagePreviewText,
  firstLinkIn,
  linkPriceIn,
  stripPaymentReceipt,
  mediaItemsFromMessage,
  type MediaItem,
} from "@/lib/utils";
import {
  IconBack,
  IconCheck,
  IconChevronRight,
  IconEyeOff,
  IconLink,
  IconLock,
  IconReply,
  IconTip,
  IconUnlock,
} from "./Icons";
import VideoPlayer from "./VideoPlayer";

const TIP_LINE_RE = /^💸 Tip · \$([\d.]+)(?:\n([\s\S]*))?$/;

export type Message = {
  id: string;
  chat_id: string;
  sender: "owner" | "guest";
  content: string | null;
  media_path: string | null;
  media_type: "image" | "video" | null;
  /** Multi-media payload; empty/missing falls back to media_path. */
  media_items?: MediaItem[] | null;
  reply_to_id: string | null;
  locked?: boolean;
  hidden?: boolean;
  // Pay-to-unlock price in cents (owner-set); 0 = manual lock only.
  price_cents?: number;
  // Has the fan paid to unlock this priced media? (reveals it for them,
  // turns the creator's own bubble green)
  unlocked?: boolean;
  created_at: string;
};

export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

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
  onJumpToReply,
  onMediaClick,
  onToggleLock,
  onUnlock,
  unlocking = false,
  highlighted = false,
  selectMode = false,
  selected = false,
  onSelectToggle,
}: {
  message: Message;
  mine: boolean;
  repliedTo: Message | null;
  onReply: (m: Message) => void;
  /** Scroll + flash the original message this bubble is replying to. */
  onJumpToReply?: (messageId: string) => void;
  onMediaClick: (m: Message, index?: number) => void;
  onToggleLock: (m: Message) => void;
  onUnlock?: (m: Message) => void;
  unlocking?: boolean;
  highlighted?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onSelectToggle?: (m: Message) => void;
}) {
  const mediaItems = mediaItemsFromMessage(message);
  const hasMedia = mediaItems.length > 0;
  const [slide, setSlide] = useState(0);
  const active = mediaItems[Math.min(slide, Math.max(mediaItems.length - 1, 0))];

  useEffect(() => {
    setSlide(0);
  }, [message.id]);

  const locked = !!message.locked;
  const price = message.price_cents ?? 0;
  // A fan who paid for this priced media sees it revealed.
  const paidUnlocked = !mine && locked && price > 0 && !!message.unlocked;
  // Creator's own priced media that the fan paid for → green bubble.
  const soldByMe = mine && price > 0 && !!message.unlocked;
  // Receiver of a locked message: blurred, unless they've paid to unlock it.
  const blurred = locked && !mine && !paidUnlocked;
  // Priced + not yet unlocked → show the pay-to-unlock overlay.
  const payToUnlock = blurred && price > 0;
  // Locked media with a link attached: tapping the blurred preview opens the
  // link (e.g. a payment page) in a new tab.
  const blurredLink = blurred && message.content ? firstLinkIn(message.content) : null;
  const blurredPrice = blurred && message.content ? linkPriceIn(message.content) : null;
  // Creator's own bubble: the price shows tiny in the bottom corner — the
  // pay-to-unlock price when set, otherwise a link-attached price label.
  const linkPrice = message.content ? linkPriceIn(message.content) : null;
  const myPriceLabel = mine
    ? price > 0
      ? formatPrice(price)
      : linkPrice
        ? `$${linkPrice}`
        : null
    : null;
  const displayContent = message.content ? stripPaymentReceipt(message.content) : "";
  const tipMatch = displayContent.match(TIP_LINE_RE);
  const isTip = !!tipMatch;
  // A locked media message whose content is only a hidden link renders no text row.
  const showText =
    !!displayContent &&
    !isTip &&
    !(hasMedia && locked && messagePreviewText(displayContent) === "");

  const replyPreview = (() => {
    if (!repliedTo) return null;
    if (repliedTo.content && messagePreviewText(repliedTo.content)) {
      return messagePreviewText(repliedTo.content);
    }
    const count = mediaItemsFromMessage(repliedTo).length;
    if (count > 1) return `${count} files`;
    return repliedTo.media_type === "image" ? "Photo" : "Video";
  })();

  // Once the fan paid, locking is irrelevant — hide the switch.
  const lockToggle = mine && hasMedia && !soldByMe && (
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
        {unlocking ? (
          <>
            <span className="w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center">
              <span className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            </span>
            <span className="text-white text-xs font-semibold drop-shadow">Unlocking…</span>
          </>
        ) : (
          <>
            <span className="w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center">
              <IconLock className="w-5 h-5 text-white" />
            </span>
            <span className="text-white text-xs font-semibold drop-shadow">Locked</span>
            {payToUnlock ? (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-accent text-white text-sm font-bold px-4 py-1.5 shadow-lg">
                Unlock {formatPrice(price)}
              </span>
            ) : (
              blurredPrice && (
                <span className="text-white text-sm font-bold drop-shadow">{`$${blurredPrice}`}</span>
              )
            )}
          </>
        )}
      </div>
      {/* Priced media → one-tap Stripe unlock (Checkout the first time) */}
      {payToUnlock && !unlocking ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUnlock?.(message);
          }}
          aria-label={`Unlock for ${formatPrice(price)}`}
          className="absolute inset-0 z-[15] cursor-pointer"
        />
      ) : unlocking ? (
        <div className="absolute inset-0 z-[15] cursor-wait" />
      ) : (
        blurredLink && (
          <a
            href={blurredLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label="Open link"
            className="absolute inset-0 z-[15] cursor-pointer"
          />
        )
      )}
    </>
  );

  function renderSlide(item: MediaItem) {
    if (item.type === "image") {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mediaUrl(item.path)}
          alt={blurred ? "Locked photo" : "Photo"}
          className={`w-full max-h-80 object-cover ${
            blurred
              ? "blur-2xl scale-110 pointer-events-none select-none"
              : "cursor-pointer"
          }`}
          onClick={blurred ? undefined : () => onMediaClick(message, slide)}
          draggable={false}
        />
      );
    }
    if (blurred) {
      return (
        <video
          src={`${mediaUrl(item.path)}#t=0.001`}
          muted
          playsInline
          preload="metadata"
          className="w-full max-h-80 object-cover blur-2xl scale-110 pointer-events-none select-none"
        />
      );
    }
    return (
      <VideoPlayer
        src={mediaUrl(item.path)}
        videoClassName="max-h-80"
        fullscreenOnPlay
      />
    );
  }

  return (
    <div
      data-message-id={message.id}
      className={`group msg-in flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}
    >
      <div
        className={`relative max-w-[78%] rounded-3xl overflow-hidden ${
          mine
            ? `${soldByMe ? "bubble-paid" : "bubble-own"} rounded-br-lg`
            : "bg-card2 rounded-bl-lg"
        } ${message.hidden ? "opacity-60" : ""} ${
          selectMode && selected ? "ring-2 ring-accent" : ""
        } ${highlighted ? "msg-highlight" : ""}`}
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
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onJumpToReply?.(repliedTo.id);
            }}
            aria-label="Jump to replied message"
            className={`mx-3 mt-2 px-3 py-1.5 rounded-xl text-xs border-l-2 text-left w-[calc(100%-1.5rem)] transition-opacity hover:opacity-90 active:opacity-75 cursor-pointer ${
              mine
                ? "bg-white/15 border-white/60 text-white/85"
                : "bg-line/60 border-accent text-muted"
            }`}
          >
            <p className="font-semibold mb-0.5">
              {repliedTo.sender === message.sender ? "Replying to self" : "Reply"}
            </p>
            <p className="truncate">{replyPreview}</p>
          </button>
        )}

        {active && (
          <div className="relative overflow-hidden">
            {renderSlide(active)}
            {lockedOverlay}
            {lockToggle}
            {mediaItems.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSlide((s) => (s - 1 + mediaItems.length) % mediaItems.length);
                  }}
                  aria-label="Previous media"
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/70"
                >
                  <IconBack className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSlide((s) => (s + 1) % mediaItems.length);
                  }}
                  aria-label="Next media"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/70"
                >
                  <IconChevronRight className="w-4 h-4" />
                </button>
                <span className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 rounded-full bg-black/55 text-white text-[10px] font-semibold px-2 py-0.5 tabular-nums">
                  {slide + 1}/{mediaItems.length}
                </span>
              </>
            )}
          </div>
        )}

        {isTip && tipMatch && (
          <div className={`px-4 py-3 flex items-start gap-2.5 ${mine ? "" : ""}`}>
            <span
              className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                mine ? "bg-white/15 text-white" : "bg-accent/15 text-accent"
              }`}
            >
              <IconTip className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className={`text-[15px] font-semibold leading-snug ${mine ? "text-white" : "text-fg"}`}>
                Tip · ${tipMatch[1]}
              </p>
              {tipMatch[2]?.trim() && (
                <p className={`mt-0.5 text-[14px] leading-snug whitespace-pre-wrap break-words ${
                  mine ? "text-white/85" : "text-fg/80"
                }`}>
                  {tipMatch[2].trim()}
                </p>
              )}
            </div>
          </div>
        )}

        {showText && displayContent && (
          <p className="px-4 py-2.5 text-[15px] leading-snug whitespace-pre-wrap break-words">
            {renderContent(displayContent, mine, hasMedia, locked)}
          </p>
        )}

        <p
          className={`px-4 pb-1.5 text-[10px] flex items-center gap-2 ${
            mine ? "text-white/60 justify-end" : "text-muted"
          } ${!showText && !isTip && hasMedia ? "pt-1.5" : "-mt-1"}`}
        >
          {myPriceLabel && (
            <span className="mr-auto font-semibold">{myPriceLabel}</span>
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
