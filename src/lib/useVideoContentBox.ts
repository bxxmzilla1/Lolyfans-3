"use client";

import { useCallback, useEffect, useState } from "react";

export type ContentBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * The pixel rect the video's actual frame occupies inside an object-contain
 * container (excluding letterbox bars). BlurDrainer coordinates are stored
 * relative to this box so the blur lands on the same spot of the VIDEO no
 * matter how the player letterboxes it.
 */
export function useVideoContentBox(
  container: HTMLElement | null,
  video: HTMLVideoElement | null
): ContentBox | null {
  const [box, setBox] = useState<ContentBox | null>(null);

  const compute = useCallback(() => {
    if (!container || !video) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!cw || !ch || !vw || !vh) return;
    const scale = Math.min(cw / vw, ch / vh);
    const width = vw * scale;
    const height = vh * scale;
    setBox({
      left: (cw - width) / 2,
      top: (ch - height) / 2,
      width,
      height,
    });
  }, [container, video]);

  useEffect(() => {
    if (!container || !video) return;
    compute();
    video.addEventListener("loadedmetadata", compute);
    const ro = new ResizeObserver(compute);
    ro.observe(container);
    window.addEventListener("resize", compute);
    return () => {
      video.removeEventListener("loadedmetadata", compute);
      ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, [container, video, compute]);

  return box;
}
