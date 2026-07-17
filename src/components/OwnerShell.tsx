"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ChatList from "./ChatList";
import VaultPanel from "./VaultPanel";
import BottomNav from "./BottomNav";
import { IconChat, IconGear, IconLink, IconLogout } from "./Icons";

function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  async function logout() {
    await supabaseBrowser().auth.signOut();
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="relative">
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 right-0 mb-2 z-50 bg-card border border-line rounded-2xl shadow-2xl overflow-hidden fade-up">
            <Link
              href="/invites"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-card2 transition-colors"
            >
              <IconLink className="w-4.5 h-4.5 text-muted" /> Invite links
            </Link>
            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-red-400 hover:bg-card2 transition-colors border-t border-line"
            >
              <IconLogout className="w-4.5 h-4.5" /> Log out
            </button>
          </div>
        </>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
          open ? "bg-card2 text-fg" : "text-muted hover:bg-card2 hover:text-fg"
        }`}
      >
        <IconGear className="w-5 h-5" />
        Settings
      </button>
    </div>
  );
}

export default function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const inChat = /^\/inbox\/./.test(pathname);
  const showVaultPanel = !pathname.startsWith("/vault");

  return (
    <div className="h-dvh flex overflow-hidden">
      {/* Left sidebar: chats + settings (desktop) */}
      <aside className="hidden lg:flex w-[320px] shrink-0 flex-col border-r border-line bg-card/60 backdrop-blur">
        <Link href="/inbox" className="px-5 py-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl ig-gradient glow-accent flex items-center justify-center">
            <IconChat className="w-5 h-5 text-white" />
          </div>
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
