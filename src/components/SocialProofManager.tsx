"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { mediaUrl, formatTime } from "@/lib/utils";
import ConfirmDialog from "./ConfirmDialog";
import { IconHeartFilled, IconPlay, IconTrash } from "./Icons";

type Post = {
  id: string;
  media_path: string;
  media_type: "image" | "video";
  caption: string | null;
  like_count: number;
  created_at: string;
};

type Comment = {
  id: string;
  chat_id: string | null;
  author_name: string;
  body: string;
  created_at: string;
};

/**
 * Social proof tab: set a follower count, a like count per post, and seed
 * Grok-written comments on any post.
 */
export default function SocialProofManager() {
  const [followers, setFollowers] = useState("");
  const [followersSaved, setFollowersSaved] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selected, setSelected] = useState<Post | null>(null);
  const [likeInput, setLikeInput] = useState("");
  const [likeSaved, setLikeSaved] = useState(false);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [genCount, setGenCount] = useState("10");
  const [genPrompt, setGenPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [error, setError] = useState("");
  const [clearAll, setClearAll] = useState(false);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const n = Number(data.user?.user_metadata?.social_followers);
        if (n > 0) setFollowers(String(n));
      });
    fetch("/api/posts")
      .then((r) => r.json())
      .then((json) => setPosts(json.posts ?? []));
  }, []);

  function selectPost(post: Post) {
    setSelected(post);
    setLikeInput(String(post.like_count ?? 0));
    setComments(null);
    setError("");
    fetch(`/api/posts/comments?postId=${post.id}`)
      .then((r) => r.json())
      .then((json) => setComments(json.comments ?? []));
  }

  async function saveFollowers() {
    const n = Math.max(0, Math.floor(Number(followers) || 0));
    await supabaseBrowser().auth.updateUser({ data: { social_followers: n } });
    setFollowersSaved(true);
    setTimeout(() => setFollowersSaved(false), 1500);
  }

  async function saveLikes() {
    if (!selected) return;
    const n = Math.max(0, Math.floor(Number(likeInput) || 0));
    const res = await fetch("/api/posts/social", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: selected.id, likeCount: n }),
    });
    if (res.ok) {
      setPosts((prev) =>
        prev.map((p) => (p.id === selected.id ? { ...p, like_count: n } : p))
      );
      setLikeSaved(true);
      setTimeout(() => setLikeSaved(false), 1500);
    }
  }

  async function generate() {
    if (!selected || generating) return;
    setGenerating(true);
    setError("");
    setGenProgress(0);
    try {
      // Big batches are generated in chunks of 50 so each Grok request stays
      // fast and never gets cut off mid-JSON.
      const total = Math.min(300, Math.max(1, Number(genCount) || 10));
      let done = 0;
      while (done < total) {
        const batch = Math.min(50, total - done);
        const res = await fetch("/api/posts/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            postId: selected.id,
            count: batch,
            instructions: genPrompt,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error || "Generation failed");
          return;
        }
        setComments((prev) =>
          [...(prev ?? []), ...(json.comments ?? [])].sort(
            (a, b) => +new Date(a.created_at) - +new Date(b.created_at)
          )
        );
        done += batch;
        setGenProgress(done);
      }
    } finally {
      setGenerating(false);
      setGenProgress(0);
    }
  }

  async function deleteComment(id: string) {
    setComments((prev) => (prev ?? []).filter((c) => c.id !== id));
    await fetch("/api/posts/comments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  async function deleteAllComments() {
    if (!selected) return;
    setComments([]);
    await fetch("/api/posts/comments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: selected.id, all: true }),
    });
  }

  const inputClass =
    "bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none";

  return (
    <div className="space-y-6">
      {/* Followers */}
      <div className="rounded-2xl border border-line bg-card p-4 space-y-3 max-w-lg">
        <p className="text-sm font-semibold">Followers</p>
        <p className="text-xs text-muted">
          Shown on your public profile, on top of real follows.
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            value={followers}
            onChange={(e) => setFollowers(e.target.value)}
            placeholder="e.g. 12400"
            className={`${inputClass} flex-1`}
          />
          <button
            onClick={saveFollowers}
            className="px-5 rounded-xl bg-accent text-white text-sm font-semibold"
          >
            {followersSaved ? "Saved!" : "Save"}
          </button>
        </div>
      </div>

      {/* Post picker */}
      <div className="space-y-2">
        <p className="text-sm font-semibold">Pick a post</p>
        {posts.length === 0 ? (
          <p className="text-sm text-muted">
            No posts yet — publish one in the Posts tab first.
          </p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {posts.map((post) => (
              <button
                key={post.id}
                onClick={() => selectPost(post)}
                className={`relative shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 transition-colors ${
                  selected?.id === post.id ? "border-accent" : "border-line"
                }`}
              >
                {post.media_type === "video" ? (
                  <>
                    <video
                      src={mediaUrl(post.media_path)}
                      preload="metadata"
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                    <IconPlay className="absolute top-1 right-1 w-3.5 h-3.5 text-white drop-shadow" />
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(post.media_path)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Likes */}
          <div className="rounded-2xl border border-line bg-card p-4 space-y-3">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <IconHeartFilled className="w-4 h-4 text-red-500" /> Likes on this post
            </p>
            <p className="text-xs text-muted">
              Base like count — real guest likes are added on top.
            </p>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                value={likeInput}
                onChange={(e) => setLikeInput(e.target.value)}
                className={`${inputClass} flex-1`}
              />
              <button
                onClick={saveLikes}
                className="px-5 rounded-xl bg-accent text-white text-sm font-semibold"
              >
                {likeSaved ? "Saved!" : "Save"}
              </button>
            </div>

            <div className="border-t border-line pt-3 space-y-2">
              <p className="text-sm font-semibold">Generate comments with Grok</p>
              <div className="flex gap-2 items-center">
                <label className="text-xs text-muted shrink-0">How many</label>
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={genCount}
                  onChange={(e) => setGenCount(e.target.value)}
                  className={`${inputClass} w-24`}
                />
              </div>
              <textarea
                value={genPrompt}
                onChange={(e) => setGenPrompt(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Optional instructions, e.g. 'flirty and hyped, mention the beach'"
                className={`${inputClass} w-full resize-none`}
              />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                onClick={generate}
                disabled={generating}
                className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-50"
              >
                {generating
                  ? `Generating… ${genProgress}/${Math.min(300, Math.max(1, Number(genCount) || 10))}`
                  : "Generate comments"}
              </button>
            </div>
          </div>

          {/* Comments on the selected post */}
          <div className="rounded-2xl border border-line bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">
                Comments {comments ? `(${comments.length})` : ""}
              </p>
              {(comments?.length ?? 0) > 0 && (
                <button
                  onClick={() => setClearAll(true)}
                  className="text-xs text-red-400 font-semibold"
                >
                  Delete all
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto space-y-2.5">
              {comments === null ? (
                <p className="text-sm text-muted">Loading…</p>
              ) : comments.length === 0 ? (
                <p className="text-sm text-muted">No comments on this post yet.</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2 group">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs">
                        <span className="font-semibold">{c.author_name}</span>{" "}
                        <span className="text-muted">
                          {formatTime(c.created_at)}
                          {c.chat_id ? " · real user" : ""}
                        </span>
                      </p>
                      <p className="text-sm break-words">{c.body}</p>
                    </div>
                    <button
                      onClick={() => deleteComment(c.id)}
                      aria-label="Delete comment"
                      className="shrink-0 text-muted hover:text-red-400 transition-colors"
                    >
                      <IconTrash className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {clearAll && selected && (
        <ConfirmDialog
          title="Delete all comments?"
          message="Every comment on this post (generated and real) will be removed."
          confirmLabel="Delete all"
          onConfirm={() => {
            deleteAllComments();
            setClearAll(false);
          }}
          onCancel={() => setClearAll(false)}
        />
      )}
    </div>
  );
}
