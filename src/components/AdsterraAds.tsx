"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Adsterra ad units for public fan-facing pages (creator profiles + home
 * feed). Pieces: the global scripts (popunder-style, invisible), the native
 * banner, and a set of display banners in various sizes.
 */

const GLOBAL_SCRIPTS = [
  "https://pl30951203.effectivecpmnetwork.com/1b/c6/ff/1bc6ff82beb6e742ca8d7eab0a9f6702.js",
  "https://pl30951204.effectivecpmnetwork.com/3d/ad/6a/3dad6a778ca1ed979b0cee83e723a509.js",
];

/** Invisible page-level ad scripts — include once per page. */
export function AdsterraScripts() {
  useEffect(() => {
    for (const src of GLOBAL_SCRIPTS) {
      if (document.querySelector(`script[src="${src}"]`)) continue;
      const s = document.createElement("script");
      s.src = src;
      document.body.appendChild(s);
    }
  }, []);
  return null;
}

const NATIVE_KEY = "5e6d16a3e9428f5da692ee33c7e51edc";

/** Native banner block (fills its container). Max one per page. */
export function AdsterraNativeBanner() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host || host.querySelector("script")) return;
    const s = document.createElement("script");
    s.async = true;
    s.setAttribute("data-cfasync", "false");
    s.src = `https://pl30951295.effectivecpmnetwork.com/${NATIVE_KEY}/invoke.js`;
    host.appendChild(s);
  }, []);
  return (
    <div ref={ref} className="px-4 py-3">
      <div id={`container-${NATIVE_KEY}`} />
    </div>
  );
}

/**
 * Display banners use document.write, which only works from a synchronous
 * script — so each unit runs inside its own isolated iframe via srcDoc.
 * That isolation also means the same unit can appear several times per page
 * and each instance loads (and counts) its own impression.
 */
function bannerHtml(host: string, key: string, width: number, height: number) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head><body><script type="text/javascript">atOptions={'key':'${key}','format':'iframe','height':${height},'width':${width},'params':{}};<\/script><script type="text/javascript" src="https://${host}/${key}/invoke.js"><\/script></body></html>`;
}

function IframeBanner({
  host,
  adKey,
  width,
  height,
  className = "flex justify-center overflow-hidden py-2",
}: {
  host: string;
  adKey: string;
  width: number;
  height: number;
  className?: string;
}) {
  // Units wider than the screen (468x60, 728x90) are scaled down to fit so
  // the whole ad stays visible on mobile instead of being clipped.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () =>
      setScale(Math.min(1, (el.clientWidth || width) / width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div className={className}>
      <div ref={wrapRef} className="w-full flex justify-center">
        <div
          style={{
            width: Math.round(width * scale),
            height: Math.round(height * scale),
            overflow: "hidden",
          }}
        >
          <iframe
            srcDoc={bannerHtml(host, adKey, width, height)}
            width={width}
            height={height}
            scrolling="no"
            title="Advertisement"
            style={{
              border: 0,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        </div>
      </div>
    </div>
  );
}

const HPF = "www.highperformanceformat.com";
const DKC = "disturbknockedcaterpillar.com";

/** 468x60 display banner, centered. */
export function AdsterraBanner468() {
  return (
    <IframeBanner
      host={HPF}
      adKey="e079873965be83788559f2d6855428d5"
      width={468}
      height={60}
    />
  );
}

/** 300x250 medium rectangle, centered. */
export function AdsterraBanner300x250() {
  return (
    <IframeBanner
      host={DKC}
      adKey="e7f376fe4216787eecef2440e7d7b19b"
      width={300}
      height={250}
    />
  );
}

/** Matches a media query without loading ads for the wrong screen size —
 *  hidden-but-loaded ads count unviewable impressions and hurt CPM. */
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState<boolean | null>(null);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** Leaderboard above the feed: 728x90 on desktop, 320x50 on mobile. */
export function AdsterraLeaderboard() {
  const desktop = useMediaQuery("(min-width: 1024px)");
  if (desktop === null) return null;
  return desktop ? (
    <IframeBanner
      host={DKC}
      adKey="ace633f9a72a0dfa564a731bd7bfb98b"
      width={728}
      height={90}
    />
  ) : (
    <IframeBanner
      host={DKC}
      adKey="dbf3551d2a6517aca402e55890c535b9"
      width={320}
      height={50}
    />
  );
}

/** Skyscrapers: pinned to the sides of the centered feed column on wide
 *  screens (160x600 left, 160x300 right); on smaller screens they render
 *  inline, side by side (160+160 = 320px, fits any phone). */
export function AdsterraSideRails() {
  const wide = useMediaQuery("(min-width: 1280px)");
  if (wide === null) return null;
  if (!wide) {
    return (
      <div className="flex justify-center items-start gap-2 py-2 px-2">
        <IframeBanner
          host={DKC}
          adKey="45f2724520bd4373cc9e9586a1fa50b4"
          width={160}
          height={600}
          className="overflow-hidden"
        />
        <IframeBanner
          host={DKC}
          adKey="60d7aea23ff7caa6d7fa069deebca0c3"
          width={160}
          height={300}
          className="overflow-hidden"
        />
      </div>
    );
  }
  return (
    <>
      <div className="fixed left-4 top-1/2 -translate-y-1/2 z-20">
        <IframeBanner
          host={DKC}
          adKey="45f2724520bd4373cc9e9586a1fa50b4"
          width={160}
          height={600}
          className="overflow-hidden"
        />
      </div>
      <div className="fixed right-4 top-1/2 -translate-y-1/2 z-20">
        <IframeBanner
          host={DKC}
          adKey="60d7aea23ff7caa6d7fa069deebca0c3"
          width={160}
          height={300}
          className="overflow-hidden"
        />
      </div>
    </>
  );
}
