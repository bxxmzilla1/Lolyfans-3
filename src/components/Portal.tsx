"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children at document.body. Needed for full-screen overlays that are
 * mounted inside the sidebars: their backdrop-blur creates a CSS containing
 * block, which would otherwise trap `position: fixed` elements inside them.
 */
export default function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
