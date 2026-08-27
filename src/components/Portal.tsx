"use client";

import { createPortal } from "react-dom";

/**
 * Renders children at document.body. Needed for full-screen overlays that are
 * mounted inside the sidebars: their backdrop-blur creates a CSS containing
 * block, which would otherwise trap `position: fixed` elements inside them.
 *
 * Renders synchronously (no mount-effect gate): waiting a frame paints one
 * overlay-less frame between two popups — a visible white flash. Every Portal
 * in the app is behind interaction state, so it never renders during SSR;
 * the document check is just belt-and-braces.
 */
export default function Portal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
