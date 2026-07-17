"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ChatList from "./ChatList";
import VaultPanel from "./VaultPanel";
import BottomNav from "./BottomNav";

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
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Settings"
        className={`w-9 h-9 rounded-full flex items-center justify-center text-lg transition-colors ${
          open ? "bg-card2 text-fg" : "text-muted hover:bg-card2 hover:text-fg"
        }`}
      >
        ⚙️
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-52 bg-card border border-line rounded-xl shadow-2xl overflow-hidden fade-up">
            <Link
              href="/invites"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium hover:bg-card2 transition-colors"
            >
              <span>🔗</span> Invite links
            </Link>
            <button
              onClick={logout}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-red-400 hover:bg-card2 transition-colors border-t border-line"
            >
              <span>↪</span> Log out
            </button>
          </div>
        </>
      )}
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
      <aside className="hidden lg:flex w-[340px] shrink-0 flex-col border-r border-line bg-card/40 backdrop-blur">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <Link href="/inbox" className="text-2xl font-bold ig-gradient-text tracking-tight">
            Lolyfans
          </Link>
          <SettingsMenu />
        </div>
        <p className="px-5 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">
          Messages
        </p>
        <div className="flex-1 overflow-y-auto">
          <ChatList />
        </div>
      </aside>

      {/* Center column */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">{children}</main>

      {/* Right sidebar: full vault (desktop) */}
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
