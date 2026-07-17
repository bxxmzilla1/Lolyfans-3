"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { fileKind, mediaUrl } from "@/lib/utils";
import {
  IconBack,
  IconCheck,
  IconChevronRight,
  IconFolder,
  IconGrid,
  IconLock,
  IconPlay,
  IconTrash,
} from "./Icons";
import VideoPlayer from "./VideoPlayer";
import ConfirmDialog from "./ConfirmDialog";

type Album = {
  id: string;
  name: string;
  vault_item_albums: { count: number }[];
};

type Item = {
  id: string;
  media_path: string;
  media_type: "image" | "video";
  created_at: string;
  // Album ids this item is shown in (it always appears in "All")
  albums: string[];
};

export default function VaultManager() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [total, setTotal] = useState(0);
  // null = album list view, "all" = the built-in All album, otherwise an album
  const [openAlbum, setOpenAlbum] = useState<"all" | Album | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<Item | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newAlbumOpen, setNewAlbumOpen] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    run: () => void;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadAlbums = useCallback(async () => {
    const res = await fetch("/api/vault/albums");
    if (res.ok) {
      const { albums, total } = await res.json();
      setAlbums(albums);
      setTotal(total);
    }
  }, []);

  const loadItems = useCallback(async () => {
    if (!openAlbum) return;
    const query = openAlbum === "all" ? "" : `?albumId=${openAlbum.id}`;
    const res = await fetch(`/api/vault/items${query}`);
    if (res.ok) {
      const { items } = (await res.json()) as { items: Item[] };
      setItems(items);
      // Drop selections for items no longer visible in this view
      setSelected((prev) => {
        const visible = new Set(items.map((i) => i.id));
        return new Set([...prev].filter((id) => visible.has(id)));
      });
    }
  }, [openAlbum]);

  useEffect(() => {
    loadAlbums();
  }, [loadAlbums]);

  useEffect(() => {
    setItems([]);
    setSelectMode(false);
    setSelected(new Set());
    loadItems();
  }, [loadItems]);

  async function createAlbum() {
    const name = newAlbumName.trim();
    if (!name) return;
    setNewAlbumOpen(false);
    setNewAlbumName("");
    await fetch("/api/vault/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    loadAlbums();
  }

  function deleteAlbum(album: Album) {
    setConfirmAction({
      title: "Delete album",
      message: `Delete album "${album.name}"? Its files stay in All.`,
      run: async () => {
        await fetch("/api/vault/albums", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: album.id }),
        });
        setOpenAlbum(null);
        loadAlbums();
      },
    });
  }

  async function handleFiles(files: FileList) {
    const albumId = openAlbum && openAlbum !== "all" ? openAlbum.id : null;
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
          .uploadToSignedUrl(path, token, file, { cacheControl: "31536000" });
        if (!error) {
          await fetch("/api/vault/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mediaPath: path, mediaType: kind, albumId }),
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

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function deleteSelected() {
    if (selected.size === 0) return;
    const ids = [...selected];
    setConfirmAction({
      title: "Delete files",
      message: `Delete ${ids.length} file${ids.length === 1 ? "" : "s"} permanently? This can't be undone.`,
      run: async () => {
        await fetch("/api/vault/items", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        setSelectMode(false);
        setSelected(new Set());
        loadItems();
        loadAlbums();
      },
    });
  }

  /** Check/uncheck an album for every selected item. */
  async function toggleAlbumForSelected(albumId: string) {
    if (selected.size === 0) return;
    const ids = [...selected];
    const allIn = ids.every(
      (id) => items.find((i) => i.id === id)?.albums.includes(albumId)
    );
    await fetch("/api/vault/items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, albumId, member: !allIn }),
    });
    loadItems();
    loadAlbums();
  }

  function deleteItem(item: Item) {
    setConfirmAction({
      title: "Delete file",
      message: "Delete this file permanently? This can't be undone.",
      run: async () => {
        await fetch("/api/vault/items", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id }),
        });
        setViewer(null);
        loadItems();
        loadAlbums();
      },
    });
  }

  const uploadInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*,video/*"
      multiple
      hidden
      onChange={(e) => e.target.files?.length && handleFiles(e.target.files)}
    />
  );

  // ---------- Album list view ----------
  if (!openAlbum) {
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
            onClick={() => setNewAlbumOpen(true)}
            className="px-4 bg-card2 border border-line rounded-xl font-semibold text-sm"
          >
            New album
          </button>
          {uploadInput}
        </div>

        {newAlbumOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setNewAlbumOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xs bg-card border border-line rounded-2xl p-4 space-y-3 fade-up"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl ig-gradient glow-accent flex items-center justify-center shrink-0">
                  <IconFolder className="w-4.5 h-4.5 text-white" />
                </div>
                <p className="font-bold">New album</p>
              </div>
              <input
                autoFocus
                value={newAlbumName}
                onChange={(e) => setNewAlbumName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createAlbum()}
                placeholder="Album name"
                className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setNewAlbumOpen(false);
                    setNewAlbumName("");
                  }}
                  className="flex-1 bg-card2 border border-line rounded-xl py-2.5 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={createAlbum}
                  disabled={!newAlbumName.trim()}
                  className="flex-1 bg-accent text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        <ul className="space-y-2">
          <li>
            <button
              onClick={() => setOpenAlbum("all")}
              className="w-full flex items-center gap-3 bg-card border border-line rounded-2xl px-4 py-3.5 hover:bg-card2 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-xl ig-gradient flex items-center justify-center shrink-0">
                <IconGrid className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[15px]">All</p>
                <p className="text-muted text-xs">
                  {total} item{total === 1 ? "" : "s"}
                </p>
              </div>
              <IconChevronRight className="w-4.5 h-4.5 text-muted shrink-0" />
            </button>
          </li>
          {albums.map((album) => {
            const count = album.vault_item_albums?.[0]?.count ?? 0;
            return (
              <li key={album.id}>
                <button
                  onClick={() => setOpenAlbum(album)}
                  className="w-full flex items-center gap-3 bg-card border border-line rounded-2xl px-4 py-3.5 hover:bg-card2 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-card2 border border-line flex items-center justify-center shrink-0">
                    <IconFolder className="w-5 h-5 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[15px] truncate">{album.name}</p>
                    <p className="text-muted text-xs">
                      {count} item{count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <IconChevronRight className="w-4.5 h-4.5 text-muted shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>

        {albums.length === 0 && total === 0 && (
          <div className="py-10 text-center flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl ig-gradient glow-accent flex items-center justify-center">
              <IconLock className="w-6 h-6 text-white" />
            </div>
            <p className="font-semibold">Vault is empty</p>
            <p className="text-muted text-sm">
              Upload photos and videos to keep them safe here.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ---------- Single album view ----------
  const albumName = openAlbum === "all" ? "All" : openAlbum.name;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => setOpenAlbum(null)}
          aria-label="Back to albums"
          className="w-9 h-9 rounded-xl bg-card2 border border-line flex items-center justify-center text-fg hover:bg-line transition-colors shrink-0"
        >
          <IconBack className="w-4.5 h-4.5" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[15px] truncate">{albumName}</p>
          <p className="text-muted text-xs">
            {items.length} item{items.length === 1 ? "" : "s"}
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            className={`h-9 px-3 rounded-xl border text-sm font-semibold transition-colors shrink-0 ${
              selectMode
                ? "bg-accent border-accent text-white"
                : "bg-card2 border-line text-fg hover:bg-line"
            }`}
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
        )}
        {openAlbum !== "all" && (
          <button
            onClick={() => deleteAlbum(openAlbum)}
            aria-label="Delete album"
            className="w-9 h-9 rounded-xl bg-card2 border border-line flex items-center justify-center text-red-400 hover:bg-line transition-colors shrink-0"
          >
            <IconTrash className="w-4.5 h-4.5" />
          </button>
        )}
      </div>

      {selectMode && (
        <div className="rounded-xl bg-card border border-line p-3 space-y-2 fade-up">
          <p className="text-xs font-semibold text-accent">
            {selected.size} selected — everything always stays in All
          </p>
          {selected.size > 0 && (
            <button
              onClick={deleteSelected}
              className="w-full flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg py-2 text-sm font-semibold hover:bg-red-500/20 transition-colors"
            >
              <IconTrash className="w-4 h-4" />
              Delete selected
            </button>
          )}
          {albums.length === 0 ? (
            <p className="text-xs text-muted">
              No albums yet. Create one to show media in it.
            </p>
          ) : selected.size === 0 ? (
            <p className="text-xs text-muted">
              Tap media below, then check the albums it should show in.
            </p>
          ) : (
            <ul className="space-y-1">
              {albums.map((album) => {
                const ids = [...selected];
                const inCount = ids.filter((id) =>
                  items.find((i) => i.id === id)?.albums.includes(album.id)
                ).length;
                const allIn = inCount === ids.length;
                const someIn = inCount > 0 && !allIn;
                return (
                  <li key={album.id}>
                    <button
                      onClick={() => toggleAlbumForSelected(album.id)}
                      className="w-full flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-card2 transition-colors text-left"
                    >
                      <span
                        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${
                          allIn
                            ? "bg-accent border-accent"
                            : someIn
                            ? "bg-accent/40 border-accent"
                            : "border-line"
                        }`}
                      >
                        {allIn && <IconCheck className="w-3 h-3 text-white" />}
                        {someIn && <span className="w-2 h-0.5 bg-white rounded" />}
                      </span>
                      <IconFolder className="w-4 h-4 text-accent shrink-0" />
                      <span className="text-sm font-medium truncate">{album.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="w-full bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-50 active:opacity-80 transition-opacity"
      >
        {uploading ? "Uploading…" : `+ Upload to ${albumName}`}
      </button>
      {uploadInput}

      {items.length === 0 ? (
        <div className="py-10 text-center flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl ig-gradient glow-accent flex items-center justify-center">
            <IconLock className="w-6 h-6 text-white" />
          </div>
          <p className="font-semibold">Nothing here yet</p>
          <p className="text-muted text-sm">Upload photos and videos to this album.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => (selectMode ? toggleSelected(item.id) : setViewer(item))}
              draggable={!selectMode}
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  "application/x-lolyfans-vault",
                  JSON.stringify({ path: item.media_path, type: item.media_type })
                );
                e.dataTransfer.effectAllowed = "copy";
              }}
              title={
                selectMode
                  ? "Tap to select"
                  : "Click to view · drag into a chat to send"
              }
              className={`relative aspect-square bg-card2 overflow-hidden rounded-md group ${
                selectMode
                  ? "cursor-pointer"
                  : "cursor-grab active:cursor-grabbing"
              } ${
                selectMode && selected.has(item.id)
                  ? "ring-2 ring-accent ring-inset"
                  : ""
              }`}
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
                    src={`${mediaUrl(item.media_path)}#t=0.001`}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                  />
                  <span className="absolute inset-0 m-auto w-8 h-8 rounded-full bg-accent/90 flex items-center justify-center">
                    <IconPlay className="w-3.5 h-3.5 text-white translate-x-px" />
                  </span>
                </>
              )}
              {selectMode && (
                <span
                  className={`absolute top-1.5 right-1.5 w-5.5 h-5.5 rounded-full border-2 flex items-center justify-center ${
                    selected.has(item.id)
                      ? "bg-accent border-accent"
                      : "bg-black/40 border-white/70"
                  }`}
                >
                  {selected.has(item.id) && (
                    <IconCheck className="w-3 h-3 text-white" />
                  )}
                </span>
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
              <VideoPlayer
                src={mediaUrl(viewer.media_path)}
                className="rounded-xl"
                videoClassName="max-h-[70vh]"
              />
            )}
          </div>
          <div
            className="flex flex-wrap items-center justify-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
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

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          onConfirm={() => {
            confirmAction.run();
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
