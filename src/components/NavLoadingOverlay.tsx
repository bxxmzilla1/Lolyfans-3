"use client";

import { useNavPending } from "@/lib/navPending";

/**
 * Subtle full-screen loading veil shown while a section change is in flight.
 * Fades in only after ~120ms so instant tab switches never flash it, and
 * lets clicks through so nothing feels blocked.
 */
export default function NavLoadingOverlay() {
  const pending = useNavPending();
  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-bg/40 backdrop-blur-[2px] transition-opacity ${
        pending ? "opacity-100 duration-200 delay-[120ms]" : "opacity-0 duration-150"
      }`}
    >
      <div className="relative w-11 h-11">
        <div className="absolute inset-0 rounded-full ig-gradient opacity-90 animate-spin [mask:radial-gradient(farthest-side,transparent_calc(100%-3px),#000_calc(100%-2.5px))]" />
      </div>
    </div>
  );
}
