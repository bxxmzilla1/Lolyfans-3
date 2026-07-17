"use client";

import { useEffect } from "react";

/**
 * Forces the invite page to the inviter's chosen theme, then restores the
 * visitor's own theme when they leave (e.g. once they start the chat) so the
 * chat itself is unaffected.
 */
export default function InviteTheme({ theme }: { theme: "light" | "dark" }) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    return () => {
      let saved = "dark";
      try {
        saved = localStorage.getItem("theme") || "dark";
      } catch {
        // ignore
      }
      root.classList.toggle("light", saved === "light");
    };
  }, [theme]);

  return null;
}
