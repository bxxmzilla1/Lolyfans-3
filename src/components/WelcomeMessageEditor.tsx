"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { fileKind, mediaUrl } from "@/lib/utils";
import { VaultPicker } from "./MassMessage";
import Portal from "./Portal";

/**
 * Settings → Welcome message: a pre-made message (text + optional image or
 * video) that is sent automatically, as the creator, the moment a new fan
 * signs up through one of their invite links.
 */
export default function WelcomeMessageEditor() {
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");
  const [mediaPath, setMediaPath] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video" | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = data.user?.user_metadata ?? {};
        setEnabled(!!meta.welcome_enabled);
        setText((meta.welcome_text as string) ?? "");
        setMediaPath((meta.welcome_media_path as string) || null);
        setMediaType((meta.welcome_media_type as "image" | "video") || null);
        setLoading(false);
      });
  }, []);

  function pickFile(f: File) {
    if (!fileKind(f)) return;
    setFile(f);
    setMediaPath(null);
    setMediaType(null);
  }

  const preview = useMemo(() => {
    if (file) return { url: URL.createObjectURL(file), type: fileKind(file) };
    if (mediaPath && mediaType) return { url: mediaUrl(mediaPath), type: mediaType };
    return null;
  }, [file, mediaPath, mediaType]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      let path = mediaPath;
      let type = mediaType;

      // A freshly picked device file gets uploaded first.
      if (file) {
        const kind = fileKind(file);
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, scope: "chat" }),
        });
        if (!res.ok) throw new Error("Upload failed");
        const { path: uploadPath, token } = await res.json();
        const { error: upErr } = await supabaseBrowser()
          .storage.from("media")
          .uploadToSignedUrl(uploadPath, token, file, { cacheControl: "31536000" });
        if (upErr) throw new Error("Upload failed");
        path = uploadPath;
        type = kind;
      }

      const { error: saveErr } = await supabaseBrowser().auth.updateUser({
        data: {
          welcome_enabled: enabled,
          welcome_text: text.trim().slice(0, 1000),
          welcome_media_path: path || "",
          welcome_media_type: path ? type || "" : "",
        },
      });
      if (saveErr) throw new Error(saveErr.message);

      setFile(null);
      setMediaPath(path);
      setMediaType(type);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-muted text-sm py-6">Loading…</p>;
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <p className="font-bold text-lg">Welcome message</p>
        <p className="text-muted text-sm mt-1">
          Sent automatically as your first message the moment a new fan follows
          you through one of your invite links and creates their account.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-line bg-card2 px-3 py-2.5">
        <div>
          <p className="text-sm font-semibold">Send welcome message</p>
          <p className="text-xs text-muted">
            Turn off to stop greeting new fans without losing the message.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          aria-label={enabled ? "Disable welcome message" : "Enable welcome message"}
          className="relative shrink-0 w-12 h-7 rounded-full bg-bg border border-line transition-colors"
        >
          <span
            className={`absolute top-1 w-4.5 h-4.5 rounded-full transition-all ${
              enabled ? "left-6.5 bg-accent" : "left-1 bg-muted"
            }`}
          />
        </button>
      </div>

      <div className="space-y-3">
        <label className="text-sm font-semibold">Message</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="Hey! So happy you're here…"
          className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none resize-none"
        />

        {preview && (
          <div className="relative inline-block">
            {preview.type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.url}
                alt=""
                className="max-h-40 rounded-xl border border-line"
              />
            ) : (
              <video
                src={preview.url}
                className="max-h-40 rounded-xl border border-line"
                muted
              />
            )}
            <button
              onClick={() => {
                setFile(null);
                setMediaPath(null);
                setMediaType(null);
              }}
              aria-label="Remove attachment"
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-card border border-line text-muted hover:text-fg flex items-center justify-center text-xs"
            >
              ✕
            </button>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])}
        />
        <div className="flex flex-wrap gap-4">
          <button
            onClick={() => fileRef.current?.click()}
            className="text-sm font-semibold text-accent hover:opacity-80"
          >
            {preview ? "Change attachment" : "+ Upload from device"}
          </button>
          <button
            onClick={() => setVaultOpen(true)}
            className="text-sm font-semibold text-accent hover:opacity-80"
          >
            + Choose from vault
          </button>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          onClick={save}
          disabled={saving}
          className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
        >
          {saved ? "Saved!" : saving ? "Saving…" : "Save welcome message"}
        </button>
      </div>

      {vaultOpen && (
        <Portal>
          {/* The picker positions itself absolutely — give it the whole screen */}
          <div className="fixed inset-0 z-[70]">
            <VaultPicker
              onPick={(item) => {
                setMediaPath(item.media_path);
                setMediaType(item.media_type);
                setFile(null);
                setVaultOpen(false);
              }}
              onClose={() => setVaultOpen(false)}
            />
          </div>
        </Portal>
      )}
    </div>
  );
}
