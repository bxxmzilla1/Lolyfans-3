"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
        className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-colors ${
          open ? "bg-card2 text-fg" : "text-muted hover:bg-card2 hover:text-fg"
        }`}
      >
        <IconGear className="w-5 h-5" />
        Settings
      </button>
    </>
  );
}

/**
 * Owner layout: a slim top bar (logo + settings) over the full-width content.
 * The old chat sidebar and vault side panel are gone — the dashboard owns
 * the whole page.
 */
export default function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const inChat = /^\/inbox\/./.test(pathname);

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <OwnerPresence />

      {/* Desktop top bar — mobile pages render their own headers */}
      <header className="hidden lg:flex shrink-0 items-center justify-between border-b border-line bg-card/60 backdrop-blur px-5 py-3">
        <Link href="/inbox" className="flex items-center gap-3">
          <Logo className="w-9 h-9 glow-accent" />
          <span className="text-xl font-bold ig-gradient-text tracking-tight">
            LolyFans
          </span>
        </Link>
        <SettingsMenu />
      </header>

      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        {children}
      </main>

      {/* Mobile bottom navigation */}
      {!inChat && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40">
          <BottomNav />
        </div>
      )}
    </div>
  );
}
