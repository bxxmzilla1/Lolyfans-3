"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useGuestShell } from "./GuestShellContext";
import { useInboxSignals, type ChatOwnerPair } from "@/lib/useInboxSignals";
import GuestAppPresence from "./GuestAppPresence";
import { IconChat, IconHome, IconUser } from "./Icons";

/**
 * Guest navigation: Home, Chats, Profile. Soft-pushes the URL so the fan
 * shell can keep panels mounted and switch instantly.
 */
export default function GuestNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const shell = useGuestShell();
  const [fallbackUnread, setFallbackUnread] = useState(0);
  const [pairs, setPairs] = useState<ChatOwnerPair[]>([]);

  const loadFallback = useCallback(async () => {
    try {
      const res = await fetch("/api/guest/chats");
      const json = await res.json();
      setFallbackUnread(json.unread ?? 0);
      setPairs(json.chats ?? []);
    } catch {
      // offline
    }
  }, []);

  // Outside the shell (/chat, /p/...) there's no bootstrap unread — fetch it,
  // then keep a slow poll as a safety net behind the realtime signals.
  useEffect(() => {
    if (shell.hasShell) return;
    loadFallback();
    const timer = setInterval(loadFallback, 30000);
    return () => clearInterval(timer);
  }, [shell.hasShell, pathname, loadFallback]);

  // Chat page just marked a conversation as read — refresh the footer badge.
  useEffect(() => {
    function onRead() {
      if (shell.hasShell) shell.refresh();
      else loadFallback();
    }
    window.addEventListener("guest-chat-read", onRead);
    return () => window.removeEventListener("guest-chat-read", onRead);
  }, [shell, loadFallback]);

  // Instant badge: refetch the moment a message lands in any of our chats.
  // Inside the shell this is off (empty pairs) — GuestShell handles it there.
  useInboxSignals(shell.hasShell ? [] : pairs, () => {
    // Give the open chat's read-marker a beat to land first, so a message
    // being read right now doesn't flash the badge.
    setTimeout(loadFallback, 800);
  });

  const unread = shell.hasShell ? shell.unread : fallbackUnread;
  const onChats = pathname === "/chats";

  function go(href: string) {
    startTransition(() => {
      router.push(href);
    });
  }

  const tabs = [
    { href: "/home", label: "Home", icon: IconHome, badge: 0 },
    {
      href: "/chats",
      label: "Chats",
      icon: IconChat,
      badge: onChats ? 0 : unread,
    },
    { href: "/profile", label: "Profile", icon: IconUser, badge: 0 },
  ];

  function Badge({ count, className }: { count: number; className?: string }) {
    if (count <= 0) return null;
    return (
      <span
        className={`min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center ${className || ""}`}
      >
        {count > 99 ? "99+" : count}
      </span>
    );
  }

  return (
    <>
      {/* Fan counts as online anywhere in the app, not just inside a chat */}
      <GuestAppPresence />

      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-line bg-card/70 backdrop-blur-lg">
        <div className="px-6 py-6">
          <p className="text-2xl font-bold ig-gradient-text tracking-tight">
            Lolyfans
          </p>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {tabs.map(({ href, label, icon: Icon, badge }) => {
            const active = pathname === href;
            return (
              <button
                key={href}
                type="button"
                onClick={() => go(href)}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-semibold transition-colors ${
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:text-fg hover:bg-card2"
                }`}
              >
                <Icon className="w-5.5 h-5.5" />
                {label}
                <Badge count={badge} className="ml-auto" />
              </button>
            );
          })}
        </nav>
      </aside>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-line2 bg-card/90 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-lg mx-auto grid grid-cols-3">
          {tabs.map(({ href, label, icon: Icon, badge }) => {
            const active = pathname === href;
            return (
              <button
                key={href}
                type="button"
                onClick={() => go(href)}
                className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <span className="relative">
                  <Icon className="w-6 h-6" />
                  <Badge count={badge} className="absolute -top-1.5 -right-2" />
                </span>
                {label}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
