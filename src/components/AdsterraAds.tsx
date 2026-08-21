"use client";

import { useEffect, useRef } from "react";

/**
 * Adsterra ad units for public fan-facing pages (creator profiles).
 * Three pieces: the global scripts (popunder-style, invisible), the native
 * banner, and the 468x60 iframe banner.
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

/** Native banner block (fills its container). */
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

// The 468x60 unit uses document.write, which only works from a synchronous
// script — so it runs inside an isolated iframe via srcDoc.
const BANNER_KEY = "e079873965be83788559f2d6855428d5";
const BANNER_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head><body><script type="text/javascript">atOptions={'key':'${BANNER_KEY}','format':'iframe','height':60,'width':468,'params':{}};<\/script><script type="text/javascript" src="https://www.highperformanceformat.com/${BANNER_KEY}/invoke.js"><\/script></body></html>`;

/** 468x60 display banner, centered. */
export function AdsterraBanner468() {
  return (
    <div className="flex justify-center overflow-hidden py-2">
      <iframe
        srcDoc={BANNER_HTML}
        width={468}
        height={60}
        scrolling="no"
        title="Advertisement"
        style={{ border: 0, maxWidth: "100%" }}
      />
    </div>
  );
}
