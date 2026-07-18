"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Portal from "./Portal";
import { formatTime } from "@/lib/utils";
import { mediaUrl } from "@/lib/utils";
import { IconChat, IconHeart, IconHeartFilled, IconSend, IconUser, IconVerified } from "./Icons";

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
};

type Comment = {
  id: string;
  author: string;
  avatarPath: string | null;
  body: string;
  createdAt: string;
};

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

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
      <div className="fixed inset-0 z-[100] bg-black/50 flex flex-col justify-end" onClick={onClose}>
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-bg rounded-t-3xl max-h-[75vh] flex flex-col fade-up"
        >
          <div className="shrink-0 py-3 border-b border-line text-center relative">
            <span className="absolute left-1/2 -translate-x-1/2 -top-0 mt-1.5 w-10 h-1 rounded-full bg-line2" />
            <p className="font-bold text-sm mt-1.5">Comments</p>
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
 * OnlyFans-style feed: full-width post cards with like and comment buttons.
 * Used on creator profiles and the guest home feed.
 */
export default function PostFeed({
  posts: initialPosts,
  canInteract,
  showOwnerHeader = true,
}: {
  posts: FeedPost[];
  canInteract: boolean;
  showOwnerHeader?: boolean;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [commentsFor, setCommentsFor] = useState<FeedPost | null>(null);

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
    <div className="py-4 space-y-4">
      {posts.map((post) => (
        <article
          key={post.id}
          className="mx-4 rounded-2xl border border-line2 bg-card overflow-hidden"
        >
          {showOwnerHeader && (
            <Link
              href={`/p/${post.ownerId}`}
              className="flex items-center gap-2.5 px-3.5 py-2.5"
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
              <span className="ml-auto text-[11px] text-muted shrink-0">
                {formatTime(post.createdAt)}
              </span>
            </Link>
          )}

          {post.type === "video" ? (
            <video
              src={post.url}
              controls
              playsInline
              preload="metadata"
              className="w-full max-h-[70vh] bg-black"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.url}
              alt={post.caption || "Post"}
              className="w-full max-h-[70vh] object-cover bg-card2"
            />
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

          {post.caption && (
            <p className="px-3.5 pt-2 text-sm whitespace-pre-wrap break-words">
              {showOwnerHeader ? (
                <>
                  <span className="font-semibold">{post.ownerName}</span> {post.caption}
                </>
              ) : (
                post.caption
              )}
            </p>
          )}
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
