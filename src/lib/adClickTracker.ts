"use client";

import { useEffect } from "react";

/** Fired on `window` every time a visitor genuinely clicks an ad unit. */
export const AD_CLICK_EVENT = "lf-ad-click";

let lastEmit = 0;
function emit() {
  // One physical click on an ad can surface through more than one listener
  // (blur + click) — collapse anything within a short window into one count.
  const now = Date.now();
  if (now - lastEmit < 800) return;
  lastEmit = now;
  window.dispatchEvent(new CustomEvent(AD_CLICK_EVENT));
}

function isAdIframe(el: Element | null): boolean {
  return el instanceof HTMLIFrameElement && el.title === "Advertisement";
}

/**
 * Detects real clicks on the Adsterra units anywhere on the page:
 *
 * - Banner units are cross-origin iframes, so their clicks can't be observed
 *   directly. The reliable signal is the window losing focus while an ad
 *   iframe is the focused element (the click moved focus into the ad).
 * - The native banner renders same-origin DOM, so a capture-phase click
 *   listener on its container works.
 *
 * Each detection dispatches AD_CLICK_EVENT, which locked videos listen to.
 */
export function useAdClickTracker(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const onBlur = () => {
      if (!isAdIframe(document.activeElement)) return;
      emit();
      // Pull focus back to the page so the NEXT ad click can be detected too
      // (a focused iframe swallows later clicks without another blur).
      setTimeout(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        window.focus();
      }, 300);
    };

    const onClickCapture = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.("[id^='container-']")) emit();
    };

    window.addEventListener("blur", onBlur);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [enabled]);
}
