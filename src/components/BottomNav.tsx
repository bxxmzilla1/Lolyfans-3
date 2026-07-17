"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/inbox", label: "Chats", icon: "💬" },
  { href: "/vault", label: "Vault", icon: "🔒" },
  { href: "/invites", label: "Links", icon: "🔗" },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="border-t border-line bg-card/80 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-2xl mx-auto flex">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${
                active ? "text-fg" : "text-muted"
              }`}
            >
              <span className={`text-xl ${active ? "" : "grayscale opacity-70"}`}>
                {tab.icon}
              </span>
              {active ? (
                <span className="ig-gradient-text font-semibold">{tab.label}</span>
              ) : (
                tab.label
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
