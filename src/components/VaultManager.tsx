"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { fileKind, mediaUrl } from "@/lib/utils";

type Album = {
  id: string;
  name: string;
  vault_items: { count: number }[];
};

type Item = {
  id: string;
  album_id: string | null;
  media_path: string;
  media_type: "image" | "video";
  created_at: string;
};

export default function VaultManager() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [activeAlbum, setActiveAlbum] = useState<string | null>(null); // null = All
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<Item | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadAlbums = useCallback(async () => {
    const res = await fetch("/api/vault/albums");
    if (res.ok) {
      const { albums } = await res.json();
      setAlbums(albums);
    }
  }, []);

  const loadItems = useCallback(async () => {
    const query = activeAlbum ? `?albumId=${activeAlbum}` : "";
    const res = await fetch(`/api/vault/items${query}`);
    if (res.ok) {
      const { items } = await res.json();
      setItems(items);
    }
  }, [activeAlbum]);

  useEffect(() => {
    loadAlbums();
  }, [loadAlbums]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  async function createAlbum() {
    const name = prompt("Album name");
    if (!name?.trim()) return;
    await fetch("/api/vault/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    loadAlbums();
  }

  async function deleteAlbum(id: string) {
    if (!confirm("Delete this album? Items inside are kept in All.")) return;
    await fetch("/api/vault/albums", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (activeAlbum === id) setActiveAlbum(null);
    loadAlbums();
    loadItems();
  }

  async function handleFiles(files: FileList) {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const kind = fileKind(file);
        if (!kind) continue;
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, scope: "vault" }),
        });
        if (!res.ok) continue;
        const { path, token } = await res.json();
        const { error } = await supabaseBrowser()
          .storage.from("media")
          .uploadToSignedUrl(path, token, file);
        if (!error) {
          await fetch("/api/vault/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mediaPath: path,
              mediaType: kind,
              albumId: activeAlbum,
            }),
          });
        }
      }
      loadItems();
      loadAlbums();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function moveItem(item: Item, albumId: string | null) {
    await fetch("/api/vault/items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, albumId }),
    });
    setViewer(null);
    loadItems();
    loadAlbums();
  }

  async function deleteItem(item: Item) {
    if (!confirm("Delete this file permanently?")) return;
    await fetch("/api/vault/items", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id }),
    });
    setViewer(null);
    loadItems();
    loadAlbums();
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex-1 bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-50 active:opacity-80 transition-opacity"
        >
          {uploading ? "Uploading…" : "+ Upload media"}
        </button>
        <button
          onClick={createAlbum}
          className="px-4 bg-card2 border border-line rounded-xl font-semibold text-sm"
        >
          New album
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => e.target.files?.length && handleFiles(e.target.files)}
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveAlbum(null)}
          className={`px-3.5 py-1.5 rounded-full text-sm font-medium border shrink-0 transition-colors ${
            activeAlbum === null
              ? "ig-gradient text-white border-transparent"
              : "bg-card2 border-line text-muted"
          }`}
        >
          All
        </button>
        {albums.map((album) => (
          <button
            key={album.id}
            onClick={() => setActiveAlbum(album.id)}
            onDoubleClick={() => deleteAlbum(album.id)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium border shrink-0 transition-colors ${
              activeAlbum === album.id
                ? "ig-gradient text-white border-transparent"
                : "bg-card2 border-line text-muted"
            }`}
            title="Double-tap to delete album"
          >
            {album.name}
            <span className="opacity-70 ml-1">
              {album.vault_items?.[0]?.count ?? 0}
            </span>
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="py-16 text-center flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-full ig-gradient flex items-center justify-center text-3xl">
            🔒
          </div>
          <p className="font-semibold">Vault is empty</p>
          <p className="text-muted text-sm">
            Upload photos and videos to keep them safe here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => setViewer(item)}
              className="relative aspect-square bg-card2 overflow-hidden rounded-sm"
            >
              {item.media_type === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(item.media_path)}
                  alt=""
                  className="w-full h-full object-cover"
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

      {viewer && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4 gap-4"
          onClick={() => setViewer(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="max-w-full max-h-[70vh]">
            {viewer.media_type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl(viewer.media_path)}
                alt=""
                className="max-w-full max-h-[70vh] rounded-xl object-contain"
              />
            ) : (
              <video
                src={mediaUrl(viewer.media_path)}
                controls
                autoPlay
                playsInline
                className="max-w-full max-h-[70vh] rounded-xl"
              />
            )}
          </div>
          <div
            className="flex flex-wrap items-center justify-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <select
              value={viewer.album_id ?? ""}
              onChange={(e) => moveItem(viewer, e.target.value || null)}
              className="bg-card2 border border-line rounded-lg px-3 py-2 text-sm"
            >
              <option value="">No album</option>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => deleteItem(viewer)}
              className="bg-card2 border border-line rounded-lg px-4 py-2 text-sm font-semibold text-red-400"
            >
              Delete
            </button>
            <button
              onClick={() => setViewer(null)}
              className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
