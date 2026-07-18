"use client";

import { useState } from "react";
import Portal from "./Portal";
import { IconPlay } from "./Icons";

export type GridPost = {
  id: string;
  url: string;
  type: "image" | "video";
  caption: string | null;
};

/** Instagram-style 3-column grid; tapping a post opens it full-screen. */
export default function PostGrid({ posts }: { posts: GridPost[] }) {
  const [active, setActive] = useState<GridPost | null>(null);

  if (!posts.length) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="font-semibold mb-1">No posts yet</p>
        <p className="text-sm text-muted">Check back later for new content.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-0.5">
        {posts.map((post) => (
          <button
            key={post.id}
            onClick={() => setActive(post)}
            className="relative aspect-square bg-card2 overflow-hidden"
          >
            {post.type === "video" ? (
              <>
                <video
                  src={post.url}
                  preload="metadata"
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                <span className="absolute top-1.5 right-1.5 text-white drop-shadow">
                  <IconPlay className="w-4 h-4" />
                </span>
              </>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.url} alt="" className="w-full h-full object-cover" />
            )}
          </button>
        ))}
      </div>

      {active && (
        <Portal>
          <div
            className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4"
            onClick={() => setActive(null)}
          >
            <div className="max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
              {active.type === "video" ? (
                <video
                  src={active.url}
                  controls
                  autoPlay
                  playsInline
                  className="w-full max-h-[75vh] rounded-xl bg-black"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={active.url}
                  alt={active.caption || ""}
                  className="w-full max-h-[75vh] object-contain rounded-xl"
                />
              )}
              {active.caption && (
                <p className="mt-3 text-white text-sm whitespace-pre-wrap break-words">
                  {active.caption}
                </p>
              )}
            </div>
            <button
              onClick={() => setActive(null)}
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </Portal>
      )}
    </>
  );
}
