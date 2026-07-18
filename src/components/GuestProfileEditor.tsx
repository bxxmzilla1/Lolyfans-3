"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { mediaUrl, resizeImage } from "@/lib/utils";
import { IconLogout, IconUser } from "./Icons";
import { invalidateGuestBootstrap } from "./GuestShell";

/** Guest profile: change picture and name. */
export default function GuestProfileEditor({
  initialName,
  initialAvatarPath,
}: {
  initialName: string;
  initialAvatarPath: string | null;
}) {
  const [name, setName] = useState(initialName);
  const [avatarPath, setAvatarPath] = useState(initialAvatarPath);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/guest/logout", { method: "POST" });
      invalidateGuestBootstrap();
      router.push("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  async function uploadAvatar(file: File) {
    setUploading(true);
    try {
      const small = await resizeImage(file);
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: small.name, scope: "avatar" }),
      });
      if (!res.ok) return;
      const { path, token } = await res.json();
      const { error } = await supabaseBrowser()
        .storage.from("media")
        .uploadToSignedUrl(path, token, small, { cacheControl: "31536000" });
      if (!error) {
        await fetch("/api/guest/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatarPath: path }),
        });
        setAvatarPath(path);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveName() {
    const clean = name.trim();
    if (!clean || clean === initialName) return;
    setSaving(true);
    setSaved(false);
    const res = await fetch("/api/guest/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: clean }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <div className="px-4 py-6 space-y-6">
      {/* Picture */}
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="relative"
          aria-label="Change profile picture"
        >
          <div className="ig-ring">
            {avatarPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl(avatarPath)}
                alt="Profile"
                className="w-24 h-24 rounded-full object-cover bg-bg"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-card2 flex items-center justify-center">
                <IconUser className="w-10 h-10 text-muted" />
              </div>
            )}
          </div>
          {uploading && (
            <span className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center text-white text-xs font-semibold">
              ...
            </span>
          )}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="text-accent text-sm font-semibold"
        >
          {uploading ? "Uploading..." : "Change picture"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadAvatar(f);
          }}
        />
      </div>

      {/* Name */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted uppercase tracking-wide">
          Your name
        </label>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="flex-1 rounded-xl bg-card border border-line2 px-4 py-3 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={saveName}
            disabled={saving || !name.trim() || name.trim() === initialName}
            className="px-5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-40"
          >
            {saving ? "..." : saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {/* Log out */}
      <div className="border-t border-line pt-4">
        <button
          onClick={logout}
          disabled={loggingOut}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-line2 bg-card text-sm font-semibold text-red-500 hover:bg-card2 transition-colors disabled:opacity-50"
        >
          <IconLogout className="w-4.5 h-4.5" />
          {loggingOut ? "Logging out…" : "Log out"}
        </button>
        <p className="text-xs text-muted text-center mt-2">
          You can log back in anytime with your email and password.
        </p>
      </div>
    </div>
  );
}
