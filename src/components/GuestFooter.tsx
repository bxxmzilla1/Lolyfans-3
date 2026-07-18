"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChat, IconHome, IconUser } from "./Icons";

/**
 * Bottom navigation for guests: Home (posts feed), Chats (their chat list)
 * and Profile. The Chats tab shows an unread badge that disappears while the
 * tab is open.
 */
export default function GuestFooter() {
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

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-line2 bg-card/90 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]">
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
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
