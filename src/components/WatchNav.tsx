"use client";

import { useEffect, useRef } from "react";
import { IconChevronRight } from "@/components/Icons";

/**
 * Prev/next navigation for the /watch video pages. Scrolling past the bottom
 * (or swiping up) loads the next video, scrolling up at the top loads the
 * previous one. Navigation is a FULL page load on purpose — every video gets
 * a fresh page so all ad units re-render and count new impressions.
 */
export default function WatchNav({
  prevHref,
  nextHref,
}: {
  prevHref: string | null;
  nextHref: string | null;
}) {
  const navigatingRef = useRef(false);

  useEffect(() => {
    const go = (href: string | null) => {
      if (!href || navigatingRef.current) return;
      navigatingRef.current = true;
      window.location.assign(href);
    };
    const atBottom = () =>
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 8;
    const atTop = () => window.scrollY <= 8;

    // Wheel: require a bit of accumulated scroll past the edge so a casual
    // scroll doesn't immediately jump pages.
    let accum = 0;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY > 0 && atBottom()) {
        accum += e.deltaY;
        if (accum > 150) go(nextHref);
      } else if (e.deltaY < 0 && atTop()) {
        accum += e.deltaY;
        if (accum < -150) go(prevHref);
      } else {
        accum = 0;
      }
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => (accum = 0), 500);
    };

    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const dy = (e.changedTouches[0]?.clientY ?? 0) - touchY;
      if (dy < -70 && atBottom()) go(nextHref);
      else if (dy > 70 && atTop()) go(prevHref);
    };

    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "ArrowDown" || e.key === "PageDown") && atBottom())
        go(nextHref);
      else if ((e.key === "ArrowUp" || e.key === "PageUp") && atTop())
        go(prevHref);
    };

    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(resetTimer);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKey);
    };
  }, [prevHref, nextHref]);

  // Plain <a> tags (not next/link) so the buttons also do full page loads.
  return (
    <div className="fixed right-3 bottom-24 z-30 flex flex-col gap-2">
      {prevHref && (
        <a
          href={prevHref}
          aria-label="Previous video"
          className="w-11 h-11 rounded-full bg-black/60 text-white backdrop-blur-sm flex items-center justify-center active:opacity-80 transition-opacity"
        >
          <IconChevronRight className="w-5 h-5 -rotate-90" />
        </a>
      )}
      {nextHref && (
        <a
          href={nextHref}
          aria-label="Next video"
          className="w-11 h-11 rounded-full bg-black/60 text-white backdrop-blur-sm flex items-center justify-center active:opacity-80 transition-opacity"
        >
          <IconChevronRight className="w-5 h-5 rotate-90" />
        </a>
      )}
    </div>
  );
}
