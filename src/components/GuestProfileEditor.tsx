"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { mediaUrl, resizeImage } from "@/lib/utils";
import { IconMoon, IconSun, IconUser } from "./Icons";

/** Guest profile: change picture, name and light/dark theme. */
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
  const [light, setLight] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let savedTheme: string | null = null;
    try {
      savedTheme = localStorage.getItem("theme");
    } catch {
      // storage unavailable
    }
    setLight(savedTheme ? savedTheme === "light" : true);
  }, []);

  function toggleTheme() {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem("theme", next ? "light" : "dark");
    } catch {
      // storage unavailable; theme still applies for this session
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

      {/* Theme */}
      <div className="flex items-center justify-between rounded-2xl border border-line2 bg-card px-4 py-3.5">
        <div className="flex items-center gap-3">
          {light ? (
            <IconSun className="w-5 h-5 text-accent" />
          ) : (
            <IconMoon className="w-5 h-5 text-accent" />
          )}
          <div>
            <p className="text-sm font-semibold">Appearance</p>
            <p className="text-xs text-muted">{light ? "Light mode" : "Dark mode"}</p>
          </div>
        </div>
        <button
          onClick={toggleTheme}
          aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
          className="relative w-14 h-8 rounded-full bg-card2 border border-line2 transition-colors"
        >
          <span
            className={`absolute top-1 w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center transition-all ${
              light ? "left-1" : "left-7"
            }`}
          >
            {light ? <IconSun className="w-3.5 h-3.5" /> : <IconMoon className="w-3.5 h-3.5" />}
          </span>
        </button>
      </div>
    </div>
  );
}
