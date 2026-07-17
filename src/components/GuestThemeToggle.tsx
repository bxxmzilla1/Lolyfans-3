"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "./Icons";

/**
 * Light/dark switch for guests in the chat header. Light mode is the default;
 * the choice is remembered on the device.
 */
export default function GuestThemeToggle() {
  const [light, setLight] = useState(true);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("theme");
    } catch {
      // storage unavailable
    }
    const isLight = saved ? saved === "light" : true;
    setLight(isLight);
    document.documentElement.classList.toggle("light", isLight);
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem("theme", next ? "light" : "dark");
    } catch {
      // storage unavailable; theme still applies for this session
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      // z-50 keeps it clickable under the invisible owner corner button
      className="relative z-50 ml-auto shrink-0 w-14 h-8 rounded-full bg-card2 border border-line2 transition-colors"
    >
      <span
        className={`absolute top-1 w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center transition-all ${
          light ? "left-1" : "left-7"
        }`}
      >
        {light ? <IconSun className="w-3.5 h-3.5" /> : <IconMoon className="w-3.5 h-3.5" />}
      </span>
    </button>
  );
}
