"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import InviteManager from "./InviteManager";
import ApiKeyManager from "./ApiKeyManager";
import SubscriptionSettings from "./SubscriptionSettings";
import TelegramSettings from "./TelegramSettings";
import ShareLinkSettings from "./ShareLinkSettings";
import Portal from "./Portal";
import {
  IconKey,
  IconLink,
  IconLogout,
  IconSend,
  IconTip,
} from "./Icons";

type Section =
  | "share"
  | "subscriptions"
  | "telegram"
  | "links"
  | "apikey";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>("share");
  const router = useRouter();

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
    router.push("/creator");
    router.refresh();
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-50 bg-bg flex flex-col fade-up">
        <header className="shrink-0 border-b border-line px-5 py-4 flex items-center justify-between bg-card/80 backdrop-blur">
          <div>
            <p className="font-bold text-lg">Settings</p>
            <p className="text-muted text-xs">
              Links, Telegram, and account
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="w-9 h-9 rounded-xl bg-card2 border border-line text-muted hover:text-fg flex items-center justify-center"
          >
            ✕
          </button>
        </header>

        <div className="shrink-0 flex gap-1.5 px-5 pt-4 pb-2 border-b border-line bg-card/40 overflow-x-auto scrollbar-none [&>button]:shrink-0">
          <button
            onClick={() => setSection("share")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
              section === "share"
                ? "bg-accent text-white"
                : "bg-card2 border border-line text-muted hover:text-fg"
            }`}
          >
            <IconLink className="w-3.5 h-3.5" /> Share link
          </button>
          <button
            onClick={() => setSection("subscriptions")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
              section === "subscriptions"
                ? "bg-accent text-white"
                : "bg-card2 border border-line text-muted hover:text-fg"
            }`}
            title="Main Telegram channel redirect for lolyfans.com"
          >
            <IconTip className="w-3.5 h-3.5" /> Main channel
          </button>
          <button
            onClick={() => setSection("telegram")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
              section === "telegram"
                ? "bg-accent text-white"
                : "bg-card2 border border-line text-muted hover:text-fg"
            }`}
          >
            <IconSend className="w-3.5 h-3.5" /> Telegram
          </button>
          <button
            onClick={() => setSection("links")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
              section === "links"
                ? "bg-accent text-white"
                : "bg-card2 border border-line text-muted hover:text-fg"
            }`}
          >
            <IconLink className="w-3.5 h-3.5" /> Invite links
          </button>
          <button
            onClick={() => setSection("apikey")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
              section === "apikey"
                ? "bg-accent text-white"
                : "bg-card2 border border-line text-muted hover:text-fg"
            }`}
          >
            <IconKey className="w-3.5 h-3.5" /> API Key
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 lg:p-8">
          <div
            className={`mx-auto w-full ${
              section === "subscriptions" ||
              section === "telegram" ||
              section === "share"
                ? "max-w-2xl"
                : "max-w-6xl"
            }`}
          >
            {section === "share" ? (
              <ShareLinkSettings />
            ) : section === "subscriptions" ? (
              <SubscriptionSettings />
            ) : section === "telegram" ? (
              <TelegramSettings />
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
