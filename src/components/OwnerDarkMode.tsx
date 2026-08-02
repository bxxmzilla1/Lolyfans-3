"use client";

import { useLayoutEffect } from "react";

/**
 * Creator-only dark mode: the app ships with `html.light` baked in for fans;
 * owner pages swap to the dark palette while mounted and restore on leave.
 */
export default function OwnerDarkMode() {
  useLayoutEffect(() => {
    const el = document.documentElement;
    const hadLight = el.classList.contains("light");
    el.classList.remove("light");
    el.classList.add("owner-dark");
    return () => {
      el.classList.remove("owner-dark");
      if (hadLight) el.classList.add("light");
    };
  }, []);
  return null;
}
