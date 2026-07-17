"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { mediaUrl } from "@/lib/utils";

type Album = { id: string; name: string; vault_items: { count: number }[] };
type Item = {
  id: string;
  album_id: string | null;
  media_path: string;
  media_type: "image" | "video";
};

export default function VaultPanel() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [activeAlbum, setActiveAlbum] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Item | null>(null);

  useEffect(() => {
    fetch("/api/vault/albums")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAlbums(d.albums));
  }, []);

  const loadItems = useCallback(() => {
    const query = activeAlbum ? `?albumId=${activeAlbum}` : "";
    fetch(`/api/vault/items${query}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setItems(d.items));
  }, [activeAlbum]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <h2 className="font-bold text-lg">Vault</h2>
        <Link href="/vault" className="text-accent text-sm font-semibold">
          Manage
        </Link>
      </div>

      <div className="flex gap-2 overflow-x-auto px-4 py-3 border-b border-line">
        <button
          onClick={() => setActiveAlbum(null)}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border shrink-0 transition-colors ${
            activeAlbum === null
              ? "ig-gradient text-white border-transparent"
              : "bg-card2 border-line text-muted hover:text-fg"
          }`}
        >
          All
        </button>
        {albums.map((album) => (
          <button
            key={album.id}
            onClick={() => setActiveAlbum(album.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border shrink-0 transition-colors ${
              activeAlbum === album.id
                ? "ig-gradient text-white border-transparent"
                : "bg-card2 border-line text-muted hover:text-fg"
            }`}
          >
            {album.name}
            <span className="opacity-70 ml-1">{album.vault_items?.[0]?.count ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
            <div className="w-12 h-12 rounded-full ig-gradient flex items-center justify-center text-xl">
              🔒
            </div>
            <p className="text-muted text-sm">
              Nothing here yet. Upload media from the Vault page.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => setViewer(item)}
                className="relative aspect-square bg-card2 overflow-hidden rounded-md group"
              >
                {item.media_type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(item.media_path)}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    loading="lazy"
                  />
                ) : (
                  <>
                    <video
                      src={mediaUrl(item.media_path)}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                    <span className="absolute top-1.5 right-1.5 text-white text-xs drop-shadow">
                      ▶
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {viewer && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6"
          onClick={() => setViewer(null)}
        >
          {viewer.media_type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl(viewer.media_path)}
              alt=""
              className="max-w-full max-h-full rounded-xl object-contain"
            />
          ) : (
            <video
              src={mediaUrl(viewer.media_path)}
              controls
              autoPlay
              playsInline
              className="max-w-full max-h-full rounded-xl"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}
