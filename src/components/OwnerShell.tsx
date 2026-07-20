"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ChatList from "./ChatList";
import VaultPanel from "./VaultPanel";
import BottomNav from "./BottomNav";
import SettingsModal from "./SettingsModal";
import OwnerPresence from "./OwnerPresence";
import Logo from "./Logo";
import { IconGear } from "./Icons";

function SettingsMenu() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && <SettingsModal onClose={() => setOpen(false)} />}
      <button
        onClick={() => setOpen(true)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
          open ? "bg-card2 text-fg" : "text-muted hover:bg-card2 hover:text-fg"
        }`}
      >
        <IconGear className="w-5 h-5" />
        Settings
      </button>
    </>
  );
}

export default function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const inChat = /^\/inbox\/./.test(pathname);
  const showVaultPanel = !pathname.startsWith("/vault");

  return (
    <div className="h-dvh flex overflow-hidden">
      <OwnerPresence />
      {/* Left sidebar: chats + settings (desktop) */}
      <aside className="hidden lg:flex w-[320px] shrink-0 flex-col border-r border-line bg-card/60 backdrop-blur">
        <Link href="/inbox" className="px-5 py-5 flex items-center gap-3">
          <Logo className="w-9 h-9 glow-accent" />
          <span className="text-xl font-bold ig-gradient-text tracking-tight">
            Lolyfans
          </span>
        </Link>
        <p className="px-5 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
          Messages
        </p>
        <div className="flex-1 overflow-y-auto pb-2">
          <ChatList />
        </div>
        <div className="border-t border-line p-3">
          <SettingsMenu />
        </div>
      </aside>

      {/* Center column */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">{children}</main>

      {/* Right sidebar: full vault (desktop) */}
      {showVaultPanel && (
        <aside className="hidden xl:flex w-[380px] shrink-0 flex-col border-l border-line bg-card/60 backdrop-blur">
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
