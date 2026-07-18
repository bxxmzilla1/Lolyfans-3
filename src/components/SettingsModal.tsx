"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { mediaUrl, resizeImage } from "@/lib/utils";
import InviteManager from "./InviteManager";
import InvitePageEditor from "./InvitePageEditor";
import ApiKeyManager from "./ApiKeyManager";
import PostsManager from "./PostsManager";
import SocialProofManager from "./SocialProofManager";
import AdminCodeDialog, { getCachedAdminCode } from "./AdminCodeDialog";
import Portal from "./Portal";
import {
  IconEdit,
  IconGrid,
  IconHeart,
  IconKey,
  IconLink,
  IconLogout,
  IconUser,
} from "./Icons";

type Section = "profile" | "posts" | "social" | "links" | "editor" | "apikey";

function ProfileSection() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
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
        setEmail(user.email ?? "");
        setDisplayName((user.user_metadata?.display_name as string) ?? "");
        setAvatarPath((user.user_metadata?.avatar_path as string) ?? null);
      });
  }, []);

  async function uploadAvatar(original: File) {
    setUploading(true);
    try {
      // Profile pictures are shown small everywhere — store a 480p version
      // so they download and render fast.
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

  async function saveName() {
    setSaving(true);
    try {
      await supabaseBrowser().auth.updateUser({
        data: { display_name: displayName.trim() },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
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
          <p className="font-semibold truncate">{displayName || "Your profile"}</p>
          <p className="text-muted text-xs truncate">{email}</p>
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
        <label className="text-sm font-semibold">Display name</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveName()}
          placeholder="Your name"
          className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
        />
        <button
          onClick={saveName}
          disabled={saving}
          className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
        >
          {saved ? "Saved!" : saving ? "Saving…" : "Save profile"}
        </button>
      </div>
    </div>
  );
}

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>("profile");
  // Which admin-gated section the user is trying to open (null = no prompt)
  const [askAdminFor, setAskAdminFor] = useState<Section | null>(null);
  const router = useRouter();

  function openGated(target: Section) {
    if (getCachedAdminCode()) {
      setSection(target);
    } else {
      setAskAdminFor(target);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function logout() {
    await supabaseBrowser().auth.signOut();
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <Portal>
    <div className="fixed inset-0 z-50 bg-bg flex flex-col fade-up">
      <header className="shrink-0 border-b border-line px-5 py-4 flex items-center justify-between bg-card/80 backdrop-blur">
        <div>
          <p className="font-bold text-lg">Settings</p>
          <p className="text-muted text-xs">Profile, invite links, and account</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close settings"
          className="w-9 h-9 rounded-xl bg-card2 border border-line text-muted hover:text-fg flex items-center justify-center"
        >
          ✕
        </button>
      </header>

      <div className="shrink-0 flex gap-1.5 px-5 pt-4 pb-2 border-b border-line bg-card/40">
        <button
          onClick={() => setSection("profile")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
            section === "profile"
              ? "bg-accent text-white"
              : "bg-card2 border border-line text-muted hover:text-fg"
          }`}
        >
          <IconUser className="w-3.5 h-3.5" /> Profile
        </button>
        <button
          onClick={() => setSection("posts")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
            section === "posts"
              ? "bg-accent text-white"
              : "bg-card2 border border-line text-muted hover:text-fg"
          }`}
        >
          <IconGrid className="w-3.5 h-3.5" /> Posts
        </button>
        <button
          onClick={() => setSection("social")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
            section === "social"
              ? "bg-accent text-white"
              : "bg-card2 border border-line text-muted hover:text-fg"
          }`}
        >
          <IconHeart className="w-3.5 h-3.5" /> Social proof
        </button>
        <button
          onClick={() => openGated("links")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
            section === "links"
              ? "bg-accent text-white"
              : "bg-card2 border border-line text-muted hover:text-fg"
          }`}
        >
          <IconLink className="w-3.5 h-3.5" /> Invite links
        </button>
        <button
          onClick={() => openGated("editor")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
            section === "editor"
              ? "bg-accent text-white"
              : "bg-card2 border border-line text-muted hover:text-fg"
          }`}
        >
          <IconEdit className="w-3.5 h-3.5" /> Invite Page Editor
        </button>
        <button
          onClick={() => openGated("apikey")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
            section === "apikey"
              ? "bg-accent text-white"
              : "bg-card2 border border-line text-muted hover:text-fg"
          }`}
        >
          <IconKey className="w-3.5 h-3.5" /> API Key
        </button>
      </div>

      {askAdminFor && (
        <AdminCodeDialog
          message={
            askAdminFor === "editor"
              ? "Enter the admin code to open the invite page editor."
              : askAdminFor === "apikey"
              ? "Enter the admin code to manage your API key."
              : "Enter the admin code to open invite links."
          }
          onVerified={() => {
            setSection(askAdminFor);
            setAskAdminFor(null);
          }}
          onCancel={() => setAskAdminFor(null)}
        />
      )}

      <div className="flex-1 overflow-y-auto p-5 lg:p-8">
        <div
          className={`mx-auto w-full ${
            section === "profile"
              ? "max-w-2xl"
              : section === "editor" || section === "posts"
              ? "max-w-4xl"
              : "max-w-6xl"
          }`}
        >
          {section === "profile" ? (
            <ProfileSection />
          ) : section === "posts" ? (
            <PostsManager />
          ) : section === "social" ? (
            <SocialProofManager />
          ) : section === "editor" ? (
            <InvitePageEditor />
          ) : section === "apikey" ? (
            <ApiKeyManager />
          ) : (
            <InviteManager />
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-line p-3 bg-card/60">
        <div className="mx-auto w-full max-w-2xl">
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-red-400 hover:bg-card2 transition-colors"
          >
            <IconLogout className="w-4.5 h-4.5" /> Log out
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
