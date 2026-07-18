"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { mediaUrl, fileKind, formatTime } from "@/lib/utils";
import ConfirmDialog from "./ConfirmDialog";
import { IconPlay, IconPlus, IconTrash } from "./Icons";

type Post = {
  id: string;
  media_path: string;
  media_type: "image" | "video";
  caption: string | null;
  created_at: string;
};

/**
 * Owner's posts: images/videos shown on their public profile and in the
 * home feed of guests who follow them.
 */
export default function PostsManager() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/posts")
      .then((r) => r.json())
      .then((json) => setPosts(json.posts ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function upload(file: File) {
    const kind = fileKind(file);
    if (!kind) return;
    setUploading(true);
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, scope: "post" }),
      });
      if (!res.ok) return;
      const { path, token } = await res.json();
      const { error } = await supabaseBrowser()
        .storage.from("media")
        .uploadToSignedUrl(path, token, file, { cacheControl: "31536000" });
      if (error) return;

      const created = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaPath: path, mediaType: kind, caption }),
      });
      if (created.ok) {
        const { post } = await created.json();
        setPosts((prev) => [post, ...prev]);
        setCaption("");
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id));
    await fetch("/api/posts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-card p-4 space-y-3">
        <p className="text-sm font-semibold">New post</p>
        <p className="text-xs text-muted">
          Posts appear on your public profile and in the home feed of people
          who follow you.
        </p>
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={500}
          placeholder="Caption (optional)"
          className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-50"
        >
          <IconPlus className="w-4 h-4" />
          {uploading ? "Uploading…" : "Choose image or video"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading posts…</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-muted">No posts yet. Publish your first one above.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {posts.map((post) => (
            <div
              key={post.id}
              className="group relative rounded-xl overflow-hidden border border-line bg-card2 aspect-square"
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
                  <span className="absolute top-2 left-2 text-white drop-shadow">
                    <IconPlay className="w-4 h-4" />
                  </span>
                </>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(post.media_path)}
                  alt={post.caption || "Post"}
                  className="w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6">
                {post.caption && (
                  <p className="text-white text-xs truncate">{post.caption}</p>
                )}
                <p className="text-white/60 text-[10px]">{formatTime(post.created_at)}</p>
              </div>
              <button
                onClick={() => setDeleteId(post.id)}
                aria-label="Delete post"
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <IconTrash className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete post?"
          message="This post will be removed from your profile and followers' feeds."
          confirmLabel="Delete"
          onConfirm={() => {
            remove(deleteId);
            setDeleteId(null);
          }}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
