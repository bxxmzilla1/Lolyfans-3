"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { fileKind, mediaUrl } from "@/lib/utils";
import { VaultPicker } from "./MassMessage";
import Portal from "./Portal";
import VoiceNote from "./VoiceNote";

/**
 * Settings → Welcome message: a pre-made message (text and/or a voice note,
 * plus an optional image or video) sent automatically, as the creator, the
 * moment a new fan signs up through one of their invite links. The voice
 * note arrives as its own bubble right after the media, so it can stand in
 * for a written caption.
 */
export default function WelcomeMessageEditor() {
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");
  const [mediaPath, setMediaPath] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video" | "audio" | null>(null);
  const [file, setFile] = useState<File | null>(null);
  // Locked media: the fan sees it blurred and pays once to unlock.
  const [mediaLocked, setMediaLocked] = useState(false);
  const [priceUsd, setPriceUsd] = useState("");
  // Voice note: its own slot, so it can ride along with an image/video.
  // "upload" sends the same audio to everyone; "tts" generates a unique
  // ElevenLabs (v3) voice note per fan with FIRSTNAME swapped in.
  const [voiceMode, setVoiceMode] = useState<"upload" | "tts">("upload");
  const [voicePath, setVoicePath] = useState<string | null>(null);
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voiceText, setVoiceText] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [hasElevenKey, setHasElevenKey] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const voiceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = data.user?.user_metadata ?? {};
        setEnabled(!!meta.welcome_enabled);
        setText((meta.welcome_text as string) ?? "");
        setMediaPath((meta.welcome_media_path as string) || null);
        setMediaType((meta.welcome_media_type as "image" | "video") || null);
        setMediaLocked(!!meta.welcome_media_locked);
        // Dollars; prices saved in the token era (1 token = 10¢) carry over.
        const cents =
          Math.round(Number(meta.welcome_media_price_cents)) ||
          (Math.round(Number(meta.welcome_media_price_tokens)) || 0) * 10;
        setPriceUsd(cents > 0 ? (cents / 100).toFixed(2).replace(/\.00$/, "") : "");
        setVoicePath((meta.welcome_voice_path as string) || null);
        setVoiceMode(meta.welcome_voice_mode === "tts" ? "tts" : "upload");
        setVoiceText((meta.welcome_voice_text as string) ?? "");
        setVoiceId((meta.welcome_voice_id as string) ?? "");
        setHasElevenKey(!!meta.elevenlabs_api_key);
        setLoading(false);
      });
  }, []);

  function pickFile(f: File) {
    if (!fileKind(f)) return;
    setFile(f);
    setMediaPath(null);
    setMediaType(null);
  }

  function pickVoice(f: File) {
    if (fileKind(f) !== "audio") return;
    setVoiceFile(f);
    setVoicePath(null);
  }

  const preview = useMemo(() => {
    if (file) return { url: URL.createObjectURL(file), type: fileKind(file) };
    if (mediaPath && mediaType) return { url: mediaUrl(mediaPath), type: mediaType };
    return null;
  }, [file, mediaPath, mediaType]);

  const voicePreview = useMemo(() => {
    if (voiceFile) return URL.createObjectURL(voiceFile);
    if (voicePath) return mediaUrl(voicePath);
    return null;
  }, [voiceFile, voicePath]);

  async function save() {
    if (saving) return;
    const cents = Math.round((parseFloat(priceUsd) || 0) * 100);
    if (mediaLocked && (file || mediaPath) && cents < 1) {
      setError("Set an unlock price or turn the lock off.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      let path = mediaPath;
      let type = mediaType;
      let vPath = voicePath;

      async function uploadDeviceFile(f: File): Promise<string> {
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: f.name, scope: "chat" }),
        });
        if (!res.ok) throw new Error("Upload failed");
        const { path: uploadPath, token } = await res.json();
        const { error: upErr } = await supabaseBrowser()
          .storage.from("media")
          .uploadToSignedUrl(uploadPath, token, f, { cacheControl: "31536000" });
        if (upErr) throw new Error("Upload failed");
        return uploadPath;
      }

      // Freshly picked device files get uploaded first.
      if (file) {
        path = await uploadDeviceFile(file);
        type = fileKind(file);
      }
      if (voiceFile) {
        vPath = await uploadDeviceFile(voiceFile);
      }

      const { error: saveErr } = await supabaseBrowser().auth.updateUser({
        data: {
          welcome_enabled: enabled,
          welcome_text: text.trim().slice(0, 1000),
          welcome_media_path: path || "",
          welcome_media_type: path ? type || "" : "",
          welcome_media_locked: !!path && mediaLocked && cents > 0,
          welcome_media_price_cents: path && mediaLocked ? cents : 0,
          // Clear the legacy token-era price so it can't shadow the new one.
          welcome_media_price_tokens: 0,
          welcome_voice_path: vPath || "",
          welcome_voice_mode: voiceMode,
          welcome_voice_text: voiceText.trim().slice(0, 1000),
          welcome_voice_id: voiceId.trim(),
        },
      });
      if (saveErr) throw new Error(saveErr.message);

      setFile(null);
      setMediaPath(path);
      setMediaType(type);
      setVoiceFile(null);
      setVoicePath(vPath);
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

        {/* Lock + price: only meaningful once an image/video is attached */}
        {preview && (
          <div className="rounded-xl border border-line bg-card2 px-3 py-2.5 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Send as locked content</p>
                <p className="text-xs text-muted">
                  New fans see it blurred and pay once to unlock it.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMediaLocked((v) => !v)}
                aria-label={mediaLocked ? "Unlock media" : "Lock media"}
                className="relative shrink-0 w-12 h-7 rounded-full bg-bg border border-line transition-colors"
              >
                <span
                  className={`absolute top-1 w-4.5 h-4.5 rounded-full transition-all ${
                    mediaLocked ? "left-6.5 bg-accent" : "left-1 bg-muted"
                  }`}
                />
              </button>
            </div>
            {mediaLocked && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted">
                  Unlock price ($)
                </label>
                <input
                  inputMode="decimal"
                  value={priceUsd}
                  onChange={(e) =>
                    setPriceUsd(e.target.value.replace(/[^\d.]/g, ""))
                  }
                  placeholder="e.g. 4.99"
                  className="w-full bg-bg border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
                />
              </div>
            )}
          </div>
        )}

        {/* Voice note: sent as its own bubble right after the message above,
            so it can replace a written caption while media rides along. */}
        <div className="space-y-3 pt-1">
          <label className="text-sm font-semibold">
            Voice note{" "}
            <span className="text-xs font-normal text-muted">(optional)</span>
          </label>

          <div className="flex rounded-xl border border-line bg-card2 p-1 text-sm font-semibold">
            <button
              type="button"
              onClick={() => setVoiceMode("upload")}
              className={`flex-1 rounded-lg py-1.5 transition-colors ${
                voiceMode === "upload" ? "bg-accent text-white" : "text-muted"
              }`}
            >
              Upload audio
            </button>
            <button
              type="button"
              onClick={() => setVoiceMode("tts")}
              className={`flex-1 rounded-lg py-1.5 transition-colors ${
                voiceMode === "tts" ? "bg-accent text-white" : "text-muted"
              }`}
            >
              AI voice · unique per fan
            </button>
          </div>

          {voiceMode === "upload" ? (
            <>
              {voicePreview ? (
                <div className="relative inline-block max-w-full">
                  <div className="rounded-2xl bg-card2 border border-line">
                    <VoiceNote src={voicePreview} mine={false} />
                  </div>
                  <button
                    onClick={() => {
                      setVoiceFile(null);
                      setVoicePath(null);
                    }}
                    aria-label="Remove voice note"
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-card border border-line text-muted hover:text-fg flex items-center justify-center text-xs"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted">
                  Fans hear it as a voice note bubble — perfect instead of a
                  written caption.
                </p>
              )}
              <input
                ref={voiceRef}
                type="file"
                accept="audio/*"
                hidden
                onChange={(e) => e.target.files?.[0] && pickVoice(e.target.files[0])}
              />
              <button
                onClick={() => voiceRef.current?.click()}
                className="text-sm font-semibold text-accent hover:opacity-80"
              >
                {voicePreview ? "Change voice note" : "+ Add a voice note (audio file)"}
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <textarea
                value={voiceText}
                onChange={(e) => setVoiceText(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Hey FIRSTNAME! [excited] So happy you found me…"
                className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none resize-none"
              />
              <p className="text-xs text-muted">
                Write <span className="font-mono text-fg">FIRSTNAME</span>{" "}
                anywhere and each fan hears their own first name (taken from
                their full name, emojis ignored — odd names become “Mister
                A”). Generated fresh for every fan with ElevenLabs&nbsp;v3, so
                you can add v3 audio tags like{" "}
                <span className="font-mono text-fg">[whispers]</span> or{" "}
                <span className="font-mono text-fg">[laughs]</span> for
                delivery.
              </p>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted">
                  ElevenLabs voice ID
                </label>
                <input
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  placeholder="e.g. JBFqnCBsd6RMkjVDRZzb"
                  className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm font-mono placeholder:text-muted focus:border-accent outline-none"
                />
              </div>
              {!hasElevenKey && (
                <p className="text-xs text-amber-500">
                  Add your ElevenLabs API key in Settings → API Key so voice
                  notes can be generated.
                </p>
              )}
            </div>
          )}
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
