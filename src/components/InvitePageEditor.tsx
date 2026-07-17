"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { mediaUrl, resizeImage } from "@/lib/utils";
import { IconUser, IconVerified } from "./Icons";

/**
 * Settings tab that customizes the public invite link page: profile picture,
 * description (with CITY / COUNTRY tokens), the join button text, and the
 * verified checkmark next to the name.
 */
export default function InvitePageEditor() {
  const [displayName, setDisplayName] = useState("");
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [buttonText, setButtonText] = useState("");
  const [verified, setVerified] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const user = data.user;
        if (!user) return;
        const meta = user.user_metadata ?? {};
        setDisplayName((meta.display_name as string) ?? "");
        setAvatarPath((meta.avatar_path as string) ?? null);
        setDescription((meta.invite_description as string) ?? "");
        setButtonText((meta.invite_button_text as string) ?? "");
        setVerified(!!meta.invite_verified);
      });
  }, []);

  async function uploadAvatar(original: File) {
    setUploading(true);
    try {
      const file = await resizeImage(original, 480);
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, scope: "avatar" }),
      });
      if (!res.ok) return;
      const { path, token } = await res.json();
      const supabase = supabaseBrowser();
      const { error } = await supabase.storage
        .from("media")
        .uploadToSignedUrl(path, token, file, { cacheControl: "31536000" });
      if (!error) {
        await supabase.auth.updateUser({ data: { avatar_path: path } });
        setAvatarPath(path);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    setSaving(true);
    try {
      await supabaseBrowser().auth.updateUser({
        data: {
          invite_description: description.trim(),
          invite_button_text: buttonText.trim(),
          invite_verified: verified,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  const previewDescription = (
    description.trim() ||
    `${displayName || "Lolyfans"} invited you to a private chat. Pick a name and start chatting — no sign-up needed.`
  )
    .replace(/COUNTRY/g, "United States")
    .replace(/CITY/g, "Los Angeles");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
      {/* ------ Editor ------ */}
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="relative shrink-0 group/avatar"
            aria-label="Change profile picture"
          >
            <div className="ig-ring">
              {avatarPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(avatarPath)}
                  alt="Profile"
                  className="w-20 h-20 rounded-full object-cover bg-bg"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-bg flex items-center justify-center">
                  <IconUser className="w-8 h-8 text-muted" />
                </div>
              )}
            </div>
            <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover/avatar:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-semibold">
              {uploading ? "…" : "Change"}
            </span>
          </button>
          <div className="min-w-0">
            <p className="font-semibold">Profile picture</p>
            <p className="text-muted text-xs">Shown at the top of your invite page.</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder={`${displayName || "Lolyfans"} invited you to a private chat. Pick a name and start chatting — no sign-up needed.`}
            className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none resize-y"
          />
          <p className="text-muted text-xs">
            Tip: write <span className="font-semibold text-fg">CITY</span> or{" "}
            <span className="font-semibold text-fg">COUNTRY</span> anywhere in the
            text and it will be replaced with the visitor&apos;s real city and
            country.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold">&quot;Start chatting&quot; button text</label>
          <input
            value={buttonText}
            onChange={(e) => setButtonText(e.target.value)}
            placeholder="Start chatting"
            className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
          />
        </div>

        <button
          onClick={() => setVerified((v) => !v)}
          className="w-full flex items-center justify-between gap-3 bg-card2 border border-line rounded-xl px-3.5 py-3 text-left"
        >
          <span className="flex items-center gap-2.5 text-sm font-semibold">
            <IconVerified className="w-5 h-5 text-[#1d9bf0]" />
            Verified checkmark
            <span className="text-muted font-normal text-xs">next to your name</span>
          </span>
          <span
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
              verified ? "bg-accent" : "bg-line"
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                verified ? "left-[22px]" : "left-0.5"
              }`}
            />
          </span>
        </button>

        <button
          onClick={save}
          disabled={saving}
          className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
        >
          {saved ? "Saved!" : saving ? "Saving…" : "Save invite page"}
        </button>
      </div>

      {/* ------ Live preview ------ */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted">Preview</p>
        <div className="rounded-2xl border border-line bg-card p-8 flex flex-col items-center gap-5">
          <div className="relative">
            <div className="ig-ring">
              {avatarPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(avatarPath)}
                  alt="Preview"
                  className="w-24 h-24 rounded-full object-cover bg-bg"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-bg flex items-center justify-center">
                  <IconUser className="w-10 h-10 text-muted" />
                </div>
              )}
            </div>
            <span className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-green-500 border-4 border-bg" />
          </div>
          <h2 className="text-2xl font-bold flex items-center gap-1.5 -mt-1">
            {displayName || "Lolyfans"}
            {verified && <IconVerified className="w-5 h-5 text-[#1d9bf0]" />}
          </h2>
          <p className="text-muted text-sm text-center whitespace-pre-wrap -mt-3">
            {previewDescription}
          </p>
          <div className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm text-center opacity-90 select-none">
            {buttonText.trim() || "Start chatting"}
          </div>
        </div>
        <p className="text-muted text-xs">
          The preview shows CITY / COUNTRY replaced with an example location.
        </p>
      </div>
    </div>
  );
}
