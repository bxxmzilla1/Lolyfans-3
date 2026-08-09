"use client";

import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

// Key the old inbox list cached under — still cleared on logout so a stale
// chat list never leaks to the next account on this device.
const INBOX_CACHE_KEY = "loly_inbox_v1";

export default function LogoutButton() {
  const router = useRouter();
  async function logout() {
    try {
      localStorage.removeItem(INBOX_CACHE_KEY);
    } catch {}
    await supabaseBrowser().auth.signOut();
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/creator");
    router.refresh();
  }
  return (
    <button onClick={logout} className="text-muted text-sm hover:text-fg transition-colors">
      Log out
    </button>
  );
}
