"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Portal from "./Portal";
import { formatCount, formatTime, mediaUrl } from "@/lib/utils";
import {
  IconChat,
  IconHeart,
  IconHeartFilled,
  IconLock,
  IconSend,
  IconUser,
  IconVerified,
  IconVolume,
  IconVolumeMute,
} from "./Icons";

/** Ad-click gate config for a post's video (from the creator's Ad Settings). */
export type FeedAdGate = {
  /** Ad clicks required to unlock the video. */
  clicks: number;
  /** Seconds of playback per unlock (0 = whole video). */
  segmentSecs: number;
  /** Ad clicks required for each next part. */
  segmentClicks: number;
  /** Adsterra ad URL opened on each click. */
  link: string | null;
};

export type FeedPost = {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerAvatar: string | null;
  verified: boolean;
  url: string;
  type: "image" | "video";
  caption: string | null;
  createdAt: string;
  likes: number;
  comments: number;
  liked: boolean;
  adGate?: FeedAdGate | null;
};

type Comment = {
  id: string;
  author: string;
  avatarPath: string | null;
  body: string;
  createdAt: string;
};

/** Bottom sheet with a post's comments and (for guests) a composer. */
function CommentsSheet({
  post,
  canComment,
  onClose,
  onAdded,
}: {
  post: FeedPost;
  canComment: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/guest/comments?postId=${post.id}`)
      .then((r) => r.json())
      .then((json) => setComments(json.comments ?? []))
      .catch(() => setComments([]));
  }, [post.id]);

  // The feed behind the panel shouldn't scroll while comments are open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/guest/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: post.id, body }),
      });
      if (res.ok) {
        const { comment } = await res.json();
        setComments((prev) => [...(prev ?? []), comment]);
        setText("");
        onAdded();
        setTimeout(() => {
          listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
        }, 50);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <Portal>
      {/* Bottom sheet on mobile, right sidebar on desktop */}
      <div
        className="fixed inset-0 z-[100] bg-black/50 flex flex-col justify-end lg:flex-row lg:justify-end"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-bg rounded-t-3xl max-h-[75vh] flex flex-col fade-up lg:h-full lg:max-h-none lg:w-96 lg:rounded-none lg:border-l lg:border-line"
        >
          <div className="shrink-0 py-3 border-b border-line text-center relative">
            <span className="absolute left-1/2 -translate-x-1/2 -top-0 mt-1.5 w-10 h-1 rounded-full bg-line2 lg:hidden" />
            <p className="font-bold text-sm mt-1.5 lg:mt-0">Comments</p>
            <button
              onClick={onClose}
              aria-label="Close comments"
              className="hidden lg:flex absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-card2 border border-line text-muted hover:text-fg items-center justify-center"
            >
              ✕
            </button>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {comments === null ? (
              <p className="text-muted text-sm text-center py-6">Loading…</p>
            ) : comments.length === 0 ? (
              <p className="text-muted text-sm text-center py-6">
                No comments yet. Be the first!
              </p>
            ) : (
              comments.map((c) => (
                <div key={c.id} className="flex items-start gap-2.5">
                  {c.avatarPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(c.avatarPath)}
                      alt={c.author}
                      className="w-8 h-8 rounded-full object-cover bg-card2 shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-card2 flex items-center justify-center shrink-0">
                      <IconUser className="w-4 h-4 text-muted" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs">
                      <span className="font-semibold">{c.author}</span>{" "}
                      <span className="text-muted">{formatTime(c.createdAt)}</span>
                    </p>
                    <p className="text-sm whitespace-pre-wrap break-words">{c.body}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {canComment && (
            <div className="shrink-0 border-t border-line p-3 pb-[max(12px,env(safe-area-inset-bottom))] flex items-center gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Add a comment…"
                maxLength={500}
                className="flex-1 bg-card2 border border-line rounded-full px-4 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
              />
              <button
                onClick={send}
                disabled={sending || !text.trim()}
                aria-label="Send comment"
                className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-40"
              >
                <IconSend className="w-4.5 h-4.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

/**
 * Inline feed video: autoplays on loop, muted by default, with a speaker
 * button to unmute. No fullscreen — it always plays in place. The muted flag
 * is set on the element directly because React doesn't reliably update the
 * muted attribute after the initial render.
 *
 * With an ad gate, the video starts locked behind an "open ad" overlay: each
 * click opens the creator's Adsterra link and counts toward the unlock. An
 * unlock grants `segmentSecs` of playback time (0 = the whole video); when
 * the time runs out, the overlay comes back asking for the next clicks.
 */
function FeedVideo({ url, gate }: { url: string; gate?: FeedAdGate | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const gated = !!gate && gate.clicks > 0;
  const [locked, setLocked] = useState(gated);
  const [clicksDone, setClicksDone] = useState(0);
  const [round, setRound] = useState(0);
  // Playback-time budget left from the last unlock (seconds).
  const budgetRef = useRef(0);
  const lastTimeRef = useRef(0);

  const required =
    !gate || round === 0 ? gate?.clicks ?? 0 : gate.segmentClicks || gate.clicks;

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    // Unmuting from the button is a user gesture, so playback may resume.
    if (v.paused && !locked) void v.play().catch(() => {});
  }

  function adClick() {
    if (!gate) return;
    // Every click opens an ad — that's what earns. Without a direct link the
    // click still counts (the page-level popunder scripts catch it).
    if (gate.link) window.open(gate.link, "_blank", "noopener");
    const next = clicksDone + 1;
    if (next < required) {
      setClicksDone(next);
      return;
    }
    // Unlocked: grant the playback budget and resume.
    setClicksDone(0);
    setRound((r) => r + 1);
    setLocked(false);
    budgetRef.current =
      gate.segmentSecs > 0 ? gate.segmentSecs : Number.POSITIVE_INFINITY;
    const v = videoRef.current;
    lastTimeRef.current = v?.currentTime ?? 0;
    void v?.play().catch(() => {});
  }

  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v || !gated || locked) return;
    if (!Number.isFinite(budgetRef.current)) return;
    // Count only small forward deltas so loops and seeks don't eat budget.
    const delta = v.currentTime - lastTimeRef.current;
    lastTimeRef.current = v.currentTime;
    if (delta > 0 && delta < 1.5) budgetRef.current -= delta;
    if (budgetRef.current <= 0) {
      v.pause();
      setLocked(true);
    }
  }

  return (
    <div className="relative block w-full overflow-hidden">
      {/* Blurred first frame fills the sides of non-16:9 videos. */}
      <video
        src={`${url}#t=0.001`}
        aria-hidden
        muted
        playsInline
        preload="metadata"
        tabIndex={-1}
        className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110"
      />
      <video
        ref={videoRef}
        src={`${url}#t=0.001`}
        autoPlay={!gated}
        loop
        muted
        playsInline
        preload="metadata"
        disablePictureInPicture
        controlsList="nodownload nofullscreen noremoteplayback"
        onTimeUpdate={onTimeUpdate}
        className={`relative w-full h-auto max-h-[70vh] object-contain ${
          gated && locked ? "blur-xl" : ""
        }`}
      />

      {gated && locked && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/55 p-4 text-center">
          <span className="w-12 h-12 rounded-full ig-gradient glow-accent flex items-center justify-center">
            <IconLock className="w-5 h-5 text-white" />
          </span>
          <p className="text-white text-sm font-semibold drop-shadow">
            {round === 0
              ? "Click the ad to unlock this video"
              : "Click the ad to keep watching"}
          </p>
          <button
            type="button"
            onClick={adClick}
            className="px-7 py-3 rounded-full bg-accent text-white text-sm font-bold active:opacity-80 transition-opacity"
          >
            Open ad{required > 1 ? ` · ${clicksDone}/${required}` : ""}
          </button>
          {required > 1 && (
            <p className="text-white/75 text-[11px]">
              {required - clicksDone} click
              {required - clicksDone === 1 ? "" : "s"} left to unlock
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-black/60 text-white backdrop-blur-sm flex items-center justify-center active:opacity-80 transition-opacity"
      >
        {muted ? (
          <IconVolumeMute className="w-5 h-5" />
        ) : (
          <IconVolume className="w-5 h-5" />
        )}
      </button>
    </div>
  );
}

/**
 * OnlyFans-style feed: full-width post cards with like and comment buttons.
 * Used on creator profiles and the guest home feed.
 */
export default function PostFeed({
  posts: initialPosts,
  canInteract,
}: {
  posts: FeedPost[];
  canInteract: boolean;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [commentsFor, setCommentsFor] = useState<FeedPost | null>(null);
  const [viewer, setViewer] = useState<FeedPost | null>(null);
  const [messaging, setMessaging] = useState<string | null>(null);
  const router = useRouter();

  /** "Message" → the creator's profile page. */
  async function message(post: FeedPost) {
    if (messaging) return;
    setMessaging(post.id);
    router.push(`/p/${post.ownerId}`);
    setMessaging(null);
  }

  async function toggleLike(post: FeedPost) {
    if (!canInteract) return;
    const liked = !post.liked;
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id ? { ...p, liked, likes: p.likes + (liked ? 1 : -1) } : p
      )
    );
    const res = await fetch("/api/guest/like", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: post.id, like: liked }),
    });
    if (!res.ok) {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? { ...p, liked: !liked, likes: p.likes + (liked ? -1 : 1) }
            : p
        )
      );
    }
  }

  if (!posts.length) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="font-semibold mb-1">No posts yet</p>
        <p className="text-sm text-muted">Check back later for new content.</p>
      </div>
    );
  }

  return (
    // Instagram-style: full-width posts separated by a hairline, no cards.
    <div className="pb-4 divide-y divide-line">
      {posts.map((post) => (
        <article key={post.id}>
          <div className="flex items-center gap-2.5 px-3.5 py-2.5">
            <Link
              href={`/p/${post.ownerId}`}
              className="flex items-center gap-2.5 min-w-0 flex-1"
            >
              {post.ownerAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(post.ownerAvatar)}
                  alt={post.ownerName}
                  className="w-9 h-9 rounded-full object-cover bg-bg"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-card2 flex items-center justify-center">
                  <IconUser className="w-4.5 h-4.5 text-muted" />
                </div>
              )}
              <span className="font-semibold text-sm flex items-center gap-1 min-w-0 truncate">
                {post.ownerName}
                {post.verified && <IconVerified className="w-4 h-4 text-sky-500 shrink-0" />}
              </span>
            </Link>
            {canInteract && (
              <button
                onClick={() => message(post)}
                disabled={messaging === post.id}
                className="shrink-0 px-3.5 py-1.5 rounded-full bg-accent text-white text-xs font-semibold disabled:opacity-60 active:opacity-80 transition-opacity"
              >
                {messaging === post.id ? "Opening…" : "Message"}
              </button>
            )}
          </div>

          {/* Caption sits above the media, under the creator's name */}
          {post.caption && (
            <p className="px-3.5 pb-2.5 text-sm whitespace-pre-wrap break-words">
              {post.caption}
            </p>
          )}

          {/* Media is never cropped: it fits the column (capped at 70% of the
              screen) over a blurred copy of itself. Videos loop in place with
              a mute toggle (no fullscreen); tapping an image opens it big. */}
          {post.type === "video" ? (
            <FeedVideo url={post.url} gate={post.adGate} />
          ) : (
            <button
              onClick={() => setViewer(post)}
              aria-label="View full screen"
              className="relative block w-full overflow-hidden"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.url}
                aria-hidden
                alt=""
                className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.url}
                alt={post.caption || "Post"}
                className="relative w-full h-auto max-h-[70vh] object-contain"
              />
            </button>
          )}

          {/* Action row: like + comment */}
          <div className="px-3.5 pt-2.5 flex items-center gap-4">
            <button
              onClick={() => toggleLike(post)}
              disabled={!canInteract}
              aria-label={post.liked ? "Unlike" : "Like"}
              className="flex items-center gap-1.5 text-sm font-semibold disabled:opacity-60"
            >
              {post.liked ? (
                <IconHeartFilled className="w-6 h-6 text-red-500" />
              ) : (
                <IconHeart className="w-6 h-6" />
              )}
              {formatCount(post.likes)}
            </button>
            <button
              onClick={() => setCommentsFor(post)}
              aria-label="Comments"
              className="flex items-center gap-1.5 text-sm font-semibold"
            >
              <IconChat className="w-6 h-6" />
              {formatCount(post.comments)}
            </button>
          </div>

          <button
            onClick={() => setCommentsFor(post)}
            className="px-3.5 pt-1.5 pb-3 text-sm text-muted"
          >
            {post.comments > 0
              ? `View all ${formatCount(post.comments)} comments`
              : "Add a comment…"}
          </button>
        </article>
      ))}

      {/* Fullscreen viewer — images only; videos always play inline. */}
      {viewer && (
        <Portal>
          <div
            className="fixed inset-0 z-[110] bg-black/95 flex items-center justify-center p-3 lg:p-8"
            onClick={() => setViewer(null)}
          >
            <div
              className="w-full max-w-4xl max-h-full"
              onClick={(e) => e.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={viewer.url}
                alt={viewer.caption || "Post"}
                onClick={() => setViewer(null)}
                className="w-full h-auto max-h-[85vh] object-contain rounded-xl cursor-pointer"
              />
            </div>
            <button
              onClick={() => setViewer(null)}
              aria-label="Close"
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white text-xl leading-none flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        </Portal>
      )}

      {commentsFor && (
        <CommentsSheet
          post={commentsFor}
          canComment={canInteract}
          onClose={() => setCommentsFor(null)}
          onAdded={() =>
            setPosts((prev) =>
              prev.map((p) =>
                p.id === commentsFor.id ? { ...p, comments: p.comments + 1 } : p
              )
            )
          }
        />
      )}
    </div>
  );
}
