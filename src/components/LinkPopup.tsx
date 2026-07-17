"use client";

import { useState } from "react";

export default function LinkPopup({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="fade-up w-full max-w-lg h-[75vh] rounded-2xl overflow-hidden bg-card border border-line flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-card2">
          <span className="w-2 h-2 rounded-full ig-gradient shrink-0" />
          <p className="flex-1 text-xs text-muted truncate">{url}</p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent font-semibold shrink-0"
          >
            Open
          </a>
          <button
            onClick={onClose}
            className="ml-2 w-7 h-7 rounded-full bg-line text-fg text-sm shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="relative flex-1 bg-white">
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-card">
              <div className="w-8 h-8 rounded-full ig-gradient animate-spin [mask:radial-gradient(farthest-side,transparent_calc(100%-3px),#000_0)]" />
            </div>
          )}
          <iframe
            src={url}
            className="w-full h-full"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={() => setLoaded(true)}
          />
        </div>
        <p className="px-4 py-2 text-[11px] text-muted bg-card2 border-t border-line">
          Some sites block preview. Tap Open to view in a new tab.
        </p>
      </div>
    </div>
  );
}
