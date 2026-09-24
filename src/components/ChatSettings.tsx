"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { fileKind, mediaUrl, resizeImage } from "@/lib/utils";
import { IconChat, IconPlus } from "./Icons";

type MediaType = "image" | "video";

/**
 * Settings → Chat: the opening message visitors see when they open the
 * creator's chat, with an optional photo / video that can stay blurred until
 * they sign up (and add their card, on paid profiles). The same message is
 * posted as the first message of every new chat.
 */
export default function ChatSettings() {
  const [text, setText] = useState("");
  const [mediaPath, setMediaPath] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<MediaType | null>(null);
  const [blur, setBlur] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = data.user?.user_metadata ?? {};
        setText((meta.chat_welcome_text as string) ?? "");
        const path = (meta.chat_welcome_media_path as string) || null;
        const type = meta.chat_welcome_media_type;
        setMediaPath(path);
        setMediaType(type === "video" || type === "image" ? type : null);
        setBlur(meta.chat_welcome_blur === undefined ? true : !!meta.chat_welcome_blur);
      });
  }, []);

  async function upload(original: File) {
    const kind = fileKind(original);
    if (kind !== "image" && kind !== "video") {
      setError("Choose an image or a video");
      return;
    }
    setUploading(true);
    setError("");
    try {
      // Photos are downscaled so the chat screen loads fast; videos as-is.
      const file = kind === "image" ? await resizeImage(original, 1080) : original;
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, scope: "welcome" }),
      });
      if (!res.ok) throw new Error("Upload failed");
      const { path, token } = await res.json();
      const supabase = supabaseBrowser();
      const { error: upErr } = await supabase.storage
        .from("media")
        .uploadToSignedUrl(path, token, file, { cacheControl: "31536000" });
      if (upErr) throw upErr;
      await supabase.auth.updateUser({
        data: { chat_welcome_media_path: path, chat_welcome_media_type: kind },
      });
      setMediaPath(path);
      setMediaType(kind);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeMedia() {
    setUploading(true);
    try {
      await supabaseBrowser().auth.updateUser({
        data: { chat_welcome_media_path: "", chat_welcome_media_type: "" },
      });
      setMediaPath(null);
      setMediaType(null);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const { error: err } = await supabaseBrowser().auth.updateUser({
        data: {
          chat_welcome_text: text.trim().slice(0, 500),
          chat_welcome_blur: blur,
        },
      });
      if (err) throw err;
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div className="rounded-2xl border border-line bg-card p-4 space-y-1">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <IconChat className="w-4 h-4 text-accent" /> Opening message
        </p>
        <p className="text-xs text-muted">
          This is the first thing people see when they open your chat, before
          they sign up. It&apos;s also sent as your first message in every new
          chat, so fans keep it once they&apos;re in.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold">Message</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={500}
          placeholder="Hey, welcome to my private chat. Sign up and say hi!"
          className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none resize-none"
        />
        <p className="text-xs text-muted">
          Write <b>CITYUSER</b> or <b>COUNTRYUSER</b> and each visitor sees
          their own city / country there (from their IP).
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold">Photo or video</p>
        {mediaPath && mediaType ? (
          <div className="relative w-64 max-w-full rounded-2xl overflow-hidden border border-line bg-card2">
            {mediaType === "video" ? (
              <video
                src={mediaUrl(mediaPath)}
                className={`w-full h-auto max-h-80 object-cover ${blur ? "blur-xl scale-110" : ""}`}
                controls={!blur}
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl(mediaPath)}
                alt="Opening message media"
                className={`w-full h-auto max-h-80 object-cover ${blur ? "blur-xl scale-110" : ""}`}
              />
            )}
            {blur && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white text-xs font-semibold">
                Blurred for visitors
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted">No photo or video attached.</p>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-50"
          >
            <IconPlus className="w-4 h-4" />
            {uploading ? "Uploading…" : mediaPath ? "Replace" : "Attach image or video"}
          </button>
          {mediaPath && (
            <button
              type="button"
              onClick={removeMedia}
              disabled={uploading}
              className="text-xs font-semibold text-red-400 hover:text-red-500 disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </div>

      <div className="flex items-center justify-between rounded-xl border border-line bg-card2 px-3 py-2.5">
        <div>
          <p className="text-sm font-semibold">Blur for visitors</p>
          <p className="text-xs text-muted">
            People without an account see the photo / video blurred with a
            lock. It&apos;s revealed once they sign up — on a paid or free-trial
            chat, once they&apos;ve added their card.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setBlur((b) => !b)}
          aria-label={blur ? "Show media to visitors" : "Blur media for visitors"}
          className="relative shrink-0 w-12 h-7 rounded-full bg-bg border border-line transition-colors"
        >
          <span
            className={`absolute top-1 w-4.5 h-4.5 rounded-full transition-all ${
              blur ? "left-6.5 bg-accent" : "left-1 bg-muted"
            }`}
          />
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={save}
        disabled={saving}
        className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {saved ? "Saved!" : saving ? "Saving…" : "Save chat"}
      </button>
    </div>
  );
}
