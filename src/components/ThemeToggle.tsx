"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { IconMoon, IconSun } from "./Icons";

type Theme = "dark" | "light";

/** Segmented Dark/Light switch. Persists the choice and applies it app-wide. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    document.documentElement.classList.toggle("light", next === "light");
    try {
      localStorage.setItem("theme", next);
    } catch {
      // storage unavailable; theme still applies for this session
    }
    // Save on the account too, so the owner's invite link page matches.
    supabaseBrowser()
      .auth.updateUser({ data: { theme: next } })
      .catch(() => {});
  }

  const options: { id: Theme; label: string; icon: React.ReactNode }[] = [
    { id: "dark", label: "Dark", icon: <IconMoon className="w-4 h-4" /> },
    { id: "light", label: "Light", icon: <IconSun className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold">Appearance</label>
      <div className="inline-flex rounded-xl bg-card2 border border-line p-1">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => apply(o.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              theme === o.id
                ? "bg-accent text-white"
                : "text-muted hover:text-fg"
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
