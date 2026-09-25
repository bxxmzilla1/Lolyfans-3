/** Browser traits shared by every browser on the same phone (see guestDevice.ts). */
export function deviceTraits() {
  if (typeof window === "undefined") return null;
  return {
    sw: window.screen?.width,
    sh: window.screen?.height,
    dpr: window.devicePixelRatio,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang: (navigator.languages?.[0] || navigator.language || "").split("-")[0],
    cores: navigator.hardwareConcurrency,
    touch: navigator.maxTouchPoints,
    depth: window.screen?.colorDepth,
  };
}
