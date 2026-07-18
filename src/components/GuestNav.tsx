"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChat, IconHome, IconUser } from "./Icons";

/**
 * Guest navigation: Home (posts feed), Chats (their chat list) and Profile.
 * Renders as a bottom bar on mobile and a left sidebar on desktop. The Chats
 * tab shows an unread badge that disappears while the tab is open.
 */
export default function GuestNav() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/guest/chats");
        const json = await res.json();
        if (alive) setUnread(json.unread ?? 0);
      } catch {
        // offline; badge just stays as-is
      }
    }
    load();
    const timer = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pathname]);

  const onChats = pathname === "/chats";

  const tabs = [
    { href: "/home", label: "Home", icon: IconHome, badge: 0 },
    { href: "/chats", label: "Chats", icon: IconChat, badge: onChats ? 0 : unread },
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
      {/* Desktop: left sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-line bg-card/70 backdrop-blur-lg">
        <div className="px-6 py-6">
          <p className="text-2xl font-bold ig-gradient-text tracking-tight">Lolyfans</p>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {tabs.map(({ href, label, icon: Icon, badge }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-semibold transition-colors ${
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:text-fg hover:bg-card2"
                }`}
              >
                <Icon className="w-5.5 h-5.5" />
                {label}
                <Badge count={badge} className="ml-auto" />
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile: bottom bar */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-line2 bg-card/90 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-lg mx-auto grid grid-cols-3">
          {tabs.map(({ href, label, icon: Icon, badge }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <span className="relative">
                  <Icon className="w-6 h-6" />
                  <Badge count={badge} className="absolute -top-1.5 -right-2" />
                </span>
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
