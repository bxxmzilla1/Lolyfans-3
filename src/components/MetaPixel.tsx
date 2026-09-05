"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * The inline base snippet (app/layout.tsx) fires PageView on every full page
 * load; this re-fires it on client-side navigations, which the snippet alone
 * would miss in a single-page app.
 */
export default function MetaPixelRouteTracker() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.fbq?.("track", "PageView");
  }, [pathname]);

  return null;
}
