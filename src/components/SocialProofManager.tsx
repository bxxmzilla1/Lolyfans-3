"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { mediaUrl, formatTime } from "@/lib/utils";
import ConfirmDialog from "./ConfirmDialog";
import Portal from "./Portal";
import { VaultPicker } from "./MassMessage";
import {
  IconHeart,
  IconHeartFilled,
  IconLock,
  IconPin,
  IconPlay,
  IconTrash,
} from "./Icons";

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

/** Blur rectangle as fractions (0–1) of the video frame. */
type BlurRegion = { x: number; y: number; w: number; h: number };

const DEFAULT_REGION: BlurRegion = { x: 0.15, y: 0.15, w: 0.7, h: 0.7 };
const MIN_REGION = 0.08;

/**
 * Social proof tab: set a profile like count, a like count per post, seed
 * Grok-written comments, and pin an un-blurable BlurDrainer video.
 */
export default function SocialProofManager() {
  const [profileLikes, setProfileLikes] = useState("");
  const [profileLikesSaved, setProfileLikesSaved] = useState(false);
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
  const [pinPath, setPinPath] = useState<string | null>(null);
  const [pinUploading, setPinUploading] = useState(false);
  const [pinError, setPinError] = useState("");
  const [pinVaultOpen, setPinVaultOpen] = useState(false);
  const [pinRegion, setPinRegion] = useState<BlurRegion>(DEFAULT_REGION);
  const [pinRegionSaved, setPinRegionSaved] = useState(false);
  const pinFileRef = useRef<HTMLInputElement>(null);
  const pinPreviewRef = useRef<HTMLDivElement>(null);
  const pinDragRef = useRef<{
    mode: "move" | "nw" | "ne" | "sw" | "se";
    startX: number;
    startY: number;
    start: BlurRegion;
    bounds: DOMRect;
  } | null>(null);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        // Kept under the old social_followers key so existing values carry over.
        const n = Number(data.user?.user_metadata?.social_followers);
        if (n > 0) setProfileLikes(String(n));
        const pin = data.user?.user_metadata?.pin_blurdrainer_path;
        if (typeof pin === "string" && pin.trim()) setPinPath(pin);
        const region = data.user?.user_metadata?.pin_blurdrainer_region as
          | Partial<BlurRegion>
          | undefined;
        if (
          region &&
          [region.x, region.y, region.w, region.h].every(
            (n) => typeof n === "number" && Number.isFinite(n)
          )
        ) {
          setPinRegion(region as BlurRegion);
        }
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

  async function saveProfileLikes() {
    const n = Math.max(0, Math.floor(Number(profileLikes) || 0));
    await supabaseBrowser().auth.updateUser({ data: { social_followers: n } });
    setProfileLikesSaved(true);
    setTimeout(() => setProfileLikesSaved(false), 1500);
  }

  async function uploadPinVideo(file: File) {
    if (!file.type.startsWith("video/")) {
      setPinError("Pick a video file");
      return;
    }
    setPinUploading(true);
    setPinError("");
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, scope: "post" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.path || !data.token) {
        setPinError(data.error || "Could not start the upload");
        return;
      }
      const supabase = supabaseBrowser();
      const { error: upErr } = await supabase.storage
        .from("media")
        .uploadToSignedUrl(data.path, data.token, file, {
          cacheControl: "31536000",
        });
      if (upErr) {
        setPinError("Upload failed — try again");
        return;
      }
      await supabase.auth.updateUser({
        data: {
          pin_blurdrainer_path: data.path,
          pin_blurdrainer_region: DEFAULT_REGION,
        },
      });
      setPinPath(data.path);
      setPinRegion(DEFAULT_REGION);
    } catch {
      setPinError("Upload failed — try again");
    } finally {
      setPinUploading(false);
      if (pinFileRef.current) pinFileRef.current.value = "";
    }
  }

  async function removePinVideo() {
    await supabaseBrowser().auth.updateUser({
      data: { pin_blurdrainer_path: "", pin_blurdrainer_region: null },
    });
    setPinPath(null);
    setPinRegion(DEFAULT_REGION);
  }

  async function pickPinFromVault(item: {
    media_path: string;
    media_type: "image" | "video";
  }) {
    if (item.media_type !== "video") {
      setPinError("The Pin Blurdrainer needs a video — pick one from the Videos tab");
      setPinVaultOpen(false);
      return;
    }
    setPinError("");
    setPinVaultOpen(false);
    await supabaseBrowser().auth.updateUser({
      data: {
        pin_blurdrainer_path: item.media_path,
        pin_blurdrainer_region: DEFAULT_REGION,
      },
    });
    setPinPath(item.media_path);
    setPinRegion(DEFAULT_REGION);
  }

  async function savePinRegion() {
    await supabaseBrowser().auth.updateUser({
      data: { pin_blurdrainer_region: pinRegion },
    });
    setPinRegionSaved(true);
    setTimeout(() => setPinRegionSaved(false), 1500);
  }

  const clamp = (n: number, lo: number, hi: number) =>
    Math.min(Math.max(n, lo), hi);

  function beginPinDrag(
    e: React.PointerEvent,
    mode: "move" | "nw" | "ne" | "sw" | "se"
  ) {
    const bounds = pinPreviewRef.current?.getBoundingClientRect();
    if (!bounds) return;
    e.preventDefault();
    e.stopPropagation();
    pinDragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      start: pinRegion,
      bounds,
    };
    const onMove = (ev: PointerEvent) => {
      const drag = pinDragRef.current;
      if (!drag) return;
      const dx = (ev.clientX - drag.startX) / drag.bounds.width;
      const dy = (ev.clientY - drag.startY) / drag.bounds.height;
      const s = drag.start;
      let next: BlurRegion;
      if (drag.mode === "move") {
        next = {
          ...s,
          x: clamp(s.x + dx, 0, 1 - s.w),
          y: clamp(s.y + dy, 0, 1 - s.h),
        };
      } else {
        const right = s.x + s.w;
        const bottom = s.y + s.h;
        const west = drag.mode === "nw" || drag.mode === "sw";
        const north = drag.mode === "nw" || drag.mode === "ne";
        const x = west ? clamp(s.x + dx, 0, right - MIN_REGION) : s.x;
        const y = north ? clamp(s.y + dy, 0, bottom - MIN_REGION) : s.y;
        const w = west
          ? right - x
          : clamp(s.w + dx, MIN_REGION, 1 - s.x);
        const h = north
          ? bottom - y
          : clamp(s.h + dy, MIN_REGION, 1 - s.y);
        next = { x, y, w, h };
      }
      setPinRegion(next);
    };
    const onUp = () => {
      pinDragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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
      {/* Profile likes */}
      <div className="rounded-2xl border border-line bg-card p-4 space-y-3 max-w-lg">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <IconHeart className="w-4 h-4 text-red-500" /> Likes
        </p>
        <p className="text-xs text-muted">
          Shown on your public profile, on top of real guest likes.
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            value={profileLikes}
            onChange={(e) => setProfileLikes(e.target.value)}
            placeholder="e.g. 12400"
            className={`${inputClass} flex-1`}
          />
          <button
            onClick={saveProfileLikes}
            className="px-5 rounded-xl bg-accent text-white text-sm font-semibold"
          >
            {profileLikesSaved ? "Saved!" : "Save"}
          </button>
        </div>
      </div>

      {/* Pin Blurdrainer */}
      <div className="rounded-2xl border border-line bg-card p-4 space-y-3 max-w-lg">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <IconPin className="w-4 h-4 text-accent" /> Pin Blurdrainer
        </p>
        <p className="text-xs text-muted">
          A video pinned to the top of your profile, looping with your blur
          shape over it. When visitors tap to unblur it they&apos;re sent to
          sign up and then into your Telegram channel — the blur never comes
          off, even after they sign up.
        </p>

        {pinPath && (
          <>
            <div
              ref={pinPreviewRef}
              className="relative rounded-xl overflow-hidden border border-line select-none touch-none"
            >
              {/* w-full h-auto keeps the intrinsic aspect ratio so the
                  fractional region maps 1:1 onto the public profile video. */}
              <video
                src={mediaUrl(pinPath)}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                className="w-full h-auto pointer-events-none"
              />
              <div
                onPointerDown={(e) => beginPinDrag(e, "move")}
                className="absolute rounded-lg border-2 border-white/90 cursor-move"
                style={{
                  left: `${pinRegion.x * 100}%`,
                  top: `${pinRegion.y * 100}%`,
                  width: `${pinRegion.w * 100}%`,
                  height: `${pinRegion.h * 100}%`,
                  backdropFilter: "blur(32px)",
                  WebkitBackdropFilter: "blur(32px)",
                  backgroundColor: "rgba(0,0,0,0.12)",
                }}
              >
                <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="w-9 h-9 rounded-xl ig-gradient glow-accent flex items-center justify-center">
                    <IconLock className="w-4 h-4 text-white" />
                  </span>
                </span>
                {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                  <span
                    key={corner}
                    onPointerDown={(e) => beginPinDrag(e, corner)}
                    className={`absolute w-4 h-4 rounded-full bg-white border-2 border-accent shadow ${
                      corner === "nw"
                        ? "-top-2 -left-2 cursor-nwse-resize"
                        : corner === "ne"
                          ? "-top-2 -right-2 cursor-nesw-resize"
                          : corner === "sw"
                            ? "-bottom-2 -left-2 cursor-nesw-resize"
                            : "-bottom-2 -right-2 cursor-nwse-resize"
                    }`}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted flex-1">
                Drag the box over what you want blurred; pull a corner to
                resize it.
              </p>
              <button
                onClick={savePinRegion}
                className="px-4 py-2 rounded-xl bg-accent text-white text-xs font-semibold shrink-0"
              >
                {pinRegionSaved ? "Saved!" : "Save blur area"}
              </button>
            </div>
          </>
        )}

        {pinError && <p className="text-xs text-red-400">{pinError}</p>}

        <div className="flex gap-2">
          <button
            onClick={() => setPinVaultOpen(true)}
            disabled={pinUploading}
            className="flex-1 rounded-xl bg-accent text-white text-sm font-semibold py-2.5 disabled:opacity-50"
          >
            Choose from vault
          </button>
          <button
            onClick={() => pinFileRef.current?.click()}
            disabled={pinUploading}
            className="flex-1 rounded-xl bg-card2 border border-line text-sm font-semibold py-2.5 disabled:opacity-50"
          >
            {pinUploading
              ? "Uploading…"
              : pinPath
              ? "Replace video"
              : "Upload video"}
          </button>
          {pinPath && (
            <button
              onClick={removePinVideo}
              disabled={pinUploading}
              className="px-4 rounded-xl bg-card2 border border-line text-sm font-semibold text-red-400 disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
        <input
          ref={pinFileRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) =>
            e.target.files?.[0] && uploadPinVideo(e.target.files[0])
          }
        />
      </div>

      {pinVaultOpen && (
        <Portal>
          <div className="fixed inset-0 z-[80]">
            <VaultPicker
              onPick={(item) => void pickPinFromVault(item)}
              onClose={() => setPinVaultOpen(false)}
            />
          </div>
        </Portal>
      )}

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
