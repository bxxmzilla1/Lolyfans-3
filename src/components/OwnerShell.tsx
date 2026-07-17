"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ChatList from "./ChatList";
import VaultPanel from "./VaultPanel";
import LogoutButton from "./LogoutButton";
import BottomNav from "./BottomNav";

const NAV = [
  { href: "/inbox", label: "Chats", icon: "💬" },
  { href: "/vault", label: "Vault", icon: "🔒" },
  { href: "/invites", label: "Links", icon: "🔗" },
];

export default function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const inChat = /^\/inbox\/./.test(pathname);
  const showVaultPanel = !pathname.startsWith("/vault");

  return (
    <div className="h-dvh flex overflow-hidden">
      {/* Left sidebar: navigation + chats (desktop) */}
      <aside className="hidden lg:flex w-[340px] shrink-0 flex-col border-r border-line bg-card/40 backdrop-blur">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <Link href="/inbox" className="text-2xl font-bold ig-gradient-text tracking-tight">
            Lolyfans
          </Link>
          <LogoutButton />
        </div>
        <nav className="flex gap-1.5 p-3 border-b border-line">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-accent text-white"
                    : "text-muted hover:bg-card2 hover:text-fg"
                }`}
              >
                <span className={active ? "" : "grayscale opacity-80"}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <p className="px-5 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">
          Messages
        </p>
        <div className="flex-1 overflow-y-auto">
          <ChatList />
        </div>
      </aside>

      {/* Center column */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">{children}</main>

      {/* Right sidebar: vault albums + media (desktop) */}
      {showVaultPanel && (
        <aside className="hidden xl:flex w-[380px] shrink-0 flex-col border-l border-line bg-card/40 backdrop-blur">
          <VaultPanel />
        </aside>
      )}

      {/* Mobile bottom navigation */}
      {!inChat && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40">
          <BottomNav />
        </div>
      )}
    </div>
  );
}
