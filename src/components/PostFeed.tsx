"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Tapping the playing video also opens the ad in a background tab. */
  tapAd?: boolean;
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
 *
 * Progress (clicks + remaining watch time) is saved in localStorage per post:
 * opening the ad backgrounds this page, and mobile browsers often discard and
 * reload it before the visitor comes back — without persistence that reload
 * would wipe their clicks and re-lock the video they just paid for.
 */
/** How long the visitor must press and hold before an ad action fires. */
const HOLD_MS = 1000;

/**
 * Press-and-hold gesture: the action fires when the pointer is released
 * after being held for HOLD_MS. Firing on release keeps window.open inside
 * a real user gesture (popup blockers allow it) and filters out accidental
 * taps, so every opened ad is a deliberate click.
 */
function useHold(action: () => void) {
  const [holding, setHolding] = useState(false);
  const startRef = useRef(0);

  function down(e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startRef.current = Date.now();
    setHolding(true);
  }
  function up() {
    const done = startRef.current > 0 && Date.now() - startRef.current >= HOLD_MS;
    startRef.current = 0;
    setHolding(false);
    if (done) action();
  }
  function cancel() {
    startRef.current = 0;
    setHolding(false);
  }

  return {
    holding,
    props: {
      onPointerDown: down,
      onPointerUp: up,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
  };
}

function FeedVideo({
  id,
  url,
  gate,
}: {
  id: string;
  url: string;
  gate?: FeedAdGate | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const gated = !!gate;
  // clicks = 0 → the first part plays free; the timed re-lock still applies.
  const freeStart = !!gate && gate.clicks < 1;
  const [locked, setLocked] = useState(gated && !freeStart);
  const [clicksDone, setClicksDone] = useState(0);
  // Round 0 = the initial unlock; a free start begins at round 1.
  const [round, setRound] = useState(freeStart ? 1 : 0);
  // Playback-time budget left from the last unlock (seconds).
  const budgetRef = useRef(
    freeStart && gate
      ? gate.segmentSecs > 0
        ? gate.segmentSecs
        : Number.POSITIVE_INFINITY
      : 0
  );
  const lastTimeRef = useRef(0);
  const lastPersistRef = useRef(0);
  const lastTapAdRef = useRef(0);
  const storeKey = `lf-adgate:${id}`;

  const required =
    !gate || round === 0 ? gate?.clicks ?? 0 : gate.segmentClicks || gate.clicks;

  // Unlock progress survives the page being reloaded after an ad visit.
  // Infinity (whole video unlocked) is stored as -1; entries expire after 6h.
  const persist = useCallback(
    (state: { round: number; clicksDone: number; budget: number }) => {
      try {
        localStorage.setItem(
          storeKey,
          JSON.stringify({
            round: state.round,
            clicksDone: state.clicksDone,
            budget: Number.isFinite(state.budget) ? state.budget : -1,
            ts: Date.now(),
          })
        );
      } catch {}
    },
    [storeKey]
  );

  useEffect(() => {
    if (!gated) return;
    try {
      const raw = localStorage.getItem(storeKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        round?: number;
        clicksDone?: number;
        budget?: number;
        ts?: number;
      };
      if (!saved.ts || Date.now() - saved.ts > 6 * 3600_000) {
        localStorage.removeItem(storeKey);
        return;
      }
      const savedRound = Math.max(0, Math.floor(Number(saved.round) || 0));
      const savedClicks = Math.max(0, Math.floor(Number(saved.clicksDone) || 0));
      const budget =
        saved.budget === -1
          ? Number.POSITIVE_INFINITY
          : Math.max(0, Number(saved.budget) || 0);
      setRound(savedRound);
      setClicksDone(savedClicks);
      if (savedRound > 0 && budget > 0) {
        budgetRef.current = budget;
        setLocked(false);
      } else if (savedRound > 0) {
        // Saved progress says the last granted time was used up — relevant
        // for free-start videos whose fresh state would begin unlocked.
        budgetRef.current = 0;
        videoRef.current?.pause();
        setLocked(true);
      }
    } catch {}
  }, [gated, storeKey]);

  // The unlocking click usually opens the ad in a new tab, so this page is
  // hidden when play() runs and the browser may reject it — leaving the
  // unlocked video frozen. Re-check every second (and the moment the visitor
  // comes back to the tab) and start playback as soon as it should be
  // unlocked, so no refresh is ever needed.
  useEffect(() => {
    if (!gated || locked) return;
    const tryPlay = () => {
      const v = videoRef.current;
      if (!v || !v.paused || budgetRef.current <= 0) return;
      void v.play().catch(() => {});
    };
    tryPlay();
    const timer = setInterval(tryPlay, 1000);
    window.addEventListener("focus", tryPlay);
    document.addEventListener("visibilitychange", tryPlay);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tryPlay);
      document.removeEventListener("visibilitychange", tryPlay);
    };
  }, [gated, locked]);

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
    const next = clicksDone + 1;
    if (next < required) {
      setClicksDone(next);
      // Persist BEFORE opening the ad — the browser may freeze/discard this
      // page the moment the new tab opens.
      persist({ round, clicksDone: next, budget: 0 });
    } else {
      // Unlocked: grant the playback budget and resume.
      const budget =
        gate.segmentSecs > 0 ? gate.segmentSecs : Number.POSITIVE_INFINITY;
      setClicksDone(0);
      setRound((r) => r + 1);
      setLocked(false);
      budgetRef.current = budget;
      persist({ round: round + 1, clicksDone: 0, budget });
      const v = videoRef.current;
      lastTimeRef.current = v?.currentTime ?? 0;
      void v?.play().catch(() => {});
    }
    // Every click opens an ad — that's what earns. Without a direct link the
    // click still counts (the page-level popunder scripts catch it).
    if (gate.link) window.open(gate.link, "_blank", "noopener");
  }

  // Ad Settings → "ad on tap": press-and-holding the playing video opens the
  // ad in a new tab and immediately pulls focus back, so it lands in the
  // background and the video keeps playing. Best-effort — some mobile
  // browsers always foreground new tabs. Throttled against double-fires.
  function onVideoTap() {
    if (!gate?.tapAd || locked) return;
    const now = Date.now();
    if (now - lastTapAdRef.current < 1500) return;
    lastTapAdRef.current = now;
    if (gate.link) {
      const w = window.open(gate.link, "_blank");
      try {
        w?.blur();
        window.focus();
      } catch {}
    }
  }

  // Both ad actions require a deliberate 1-second press-and-hold.
  const unlockHold = useHold(adClick);
  const tapHold = useHold(onVideoTap);
  const tapHoldActive = !!gate?.tapAd && !locked;

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
      persist({ round, clicksDone: 0, budget: 0 });
      return;
    }
    // Keep the saved remaining time roughly current (throttled to ~2s).
    if (Date.now() - lastPersistRef.current > 2000) {
      lastPersistRef.current = Date.now();
      persist({ round, clicksDone: 0, budget: budgetRef.current });
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
        autoPlay={!gated || freeStart}
        loop
        muted
        playsInline
        preload="metadata"
        disablePictureInPicture
        controlsList="nodownload nofullscreen noremoteplayback"
        onTimeUpdate={onTimeUpdate}
        {...(tapHoldActive ? tapHold.props : {})}
        style={
          tapHoldActive
            ? { WebkitTouchCallout: "none", userSelect: "none" }
            : undefined
        }
        className={`relative w-full h-auto max-h-[70vh] object-contain ${
          gated && locked ? "blur-xl" : ""
        }`}
      />

      {/* Hold-progress pill while the visitor presses a playing video */}
      {tapHoldActive && tapHold.holding && (
        <div className="absolute inset-x-0 bottom-16 z-10 flex justify-center pointer-events-none">
          <div className="px-4 py-2 rounded-full bg-black/70 backdrop-blur-sm text-white text-xs font-semibold w-44 text-center">
            Keep holding…
            <div className="h-1 mt-1.5 rounded-full bg-white/25 overflow-hidden">
              <div
                className="h-full bg-white rounded-full"
                style={{ animation: `lf-hold-fill ${HOLD_MS}ms linear forwards` }}
              />
            </div>
          </div>
        </div>
      )}

      {gated && locked && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/55 p-4 text-center">
          <span className="w-12 h-12 rounded-full ig-gradient glow-accent flex items-center justify-center">
            <IconLock className="w-5 h-5 text-white" />
          </span>
          <p className="text-white text-sm font-semibold drop-shadow">
            {round === 0
              ? "Open the ad to unlock this video"
              : "Open the ad to keep watching"}
          </p>
          <button
            type="button"
            {...unlockHold.props}
            className="relative overflow-hidden px-7 py-3 rounded-full bg-accent text-white text-sm font-bold select-none touch-none"
            style={{ WebkitTouchCallout: "none" }}
          >
            {unlockHold.holding && (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-white/35"
                style={{ animation: `lf-hold-fill ${HOLD_MS}ms linear forwards` }}
              />
            )}
            <span className="relative">
              {unlockHold.holding ? "Keep holding…" : "Hold to open ad"}
              {required > 1 ? ` · ${clicksDone}/${required}` : ""}
            </span>
          </button>
          <p className="text-white/75 text-[11px]">
            Press and hold for 1 second
            {required > 1
              ? ` — ${required - clicksDone} click${
                  required - clicksDone === 1 ? "" : "s"
                } left to unlock`
              : ""}
          </p>
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
            <FeedVideo id={post.id} url={post.url} gate={post.adGate} />
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
