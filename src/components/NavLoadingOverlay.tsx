"use client";

import { useNavPending } from "@/lib/navPending";

const PETALS = 12;

/**
 * Subtle full-screen loading veil shown while a section change is in flight.
 * Fades in only after ~120ms so instant tab switches never flash it, and
 * lets clicks through so nothing feels blocked.
 *
 * The spinner is the classic 12-petal wheel: each petal pulses in turn, in
 * the site's accent color, with a small "LOADING" caption in the middle.
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
      <div className="relative w-36 h-36">
        {Array.from({ length: PETALS }, (_, i) => (
          <span
            key={i}
            className="petal-spinner-petal"
            style={{
              transform: `rotate(${(360 / PETALS) * i}deg)`,
              animationDelay: `${(i / PETALS) * -1.1}s`,
            }}
          />
        ))}
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tracking-[0.15em] text-accent/70 select-none">
          LOADING
        </span>
      </div>
    </div>
  );
}
