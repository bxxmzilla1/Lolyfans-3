"use client";

import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await supabaseBrowser().auth.signOut();
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }
  return (
    <button onClick={logout} className="text-muted text-sm hover:text-fg transition-colors">
      Log out
    </button>
  );
}
