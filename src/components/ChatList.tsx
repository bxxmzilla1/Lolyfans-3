"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { formatTime } from "@/lib/utils";
import { IconCheck, IconFolder, IconLink, IconPlus } from "./Icons";
import ConfirmDialog from "./ConfirmDialog";

type ChatRow = {
  id: string;
  guest_name: string;
  guest_country: string | null;
  last_message_at: string;
  invites: { label: string | null; code: string } | null;
  preview: { content: string | null; media_type: string | null } | null;
  unread: number;
  categories: string[];
};

type Category = { id: string; name: string };

function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return "";
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

// Module-level cache: navigating between pages re-mounts the list,
// so start from the last known data instead of a loading skeleton.
let chatsCache: ChatRow[] | null = null;
let ownerIdCache: string | null = null;
let categoriesCache: Category[] | null = null;

// One shared realtime subscription for all mounted chat lists. The component
// can be mounted twice at once (desktop sidebar + mobile list), and Supabase
// forbids two subscriptions to the same channel topic on one client.
let inboxChannel: RealtimeChannel | null = null;
let inboxChannelOwner: string | null = null;
const inboxListeners = new Set<() => void>();

function subscribeInbox(ownerId: string, onEvent: () => void): () => void {
  inboxListeners.add(onEvent);
  if (!inboxChannel || inboxChannelOwner !== ownerId) {
    const supabase = supabaseBrowser();
    if (inboxChannel) supabase.removeChannel(inboxChannel);
    inboxChannelOwner = ownerId;
    inboxChannel = supabase
      .channel(`inbox:${ownerId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => inboxListeners.forEach((listener) => listener())
      )
      .on("broadcast", { event: "new-message" }, () =>
        inboxListeners.forEach((listener) => listener())
      )
      .subscribe();
  }
  return () => {
    inboxListeners.delete(onEvent);
  };
}

export default function ChatList() {
  const [chats, setChats] = useState<ChatRow[] | null>(chatsCache);
  const [ownerId, setOwnerId] = useState<string | null>(ownerIdCache);
  const [categories, setCategories] = useState<Category[]>(categoriesCache ?? []);
  // "all" or a category id
  const [activeCat, setActiveCat] = useState<string>("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [deletingCat, setDeletingCat] = useState<Category | null>(null);
  const pathname = usePathname();
  const cancelledRef = useRef(false);

  async function load() {
    const [chatsRes, catsRes] = await Promise.all([
      fetch("/api/chats"),
      fetch("/api/categories"),
    ]);
    if (cancelledRef.current) return;
    if (chatsRes.ok) {
      const { chats, ownerId } = await chatsRes.json();
      chatsCache = chats;
      ownerIdCache = ownerId;
      setChats(chats);
      setOwnerId(ownerId);
    }
    if (catsRes.ok) {
      const { categories } = await catsRes.json();
      categoriesCache = categories;
      setCategories(categories);
    }
  }

  // Refetch on mount and on navigation (opening a chat clears its badge server-side).
  useEffect(() => {
    cancelledRef.current = false;
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Instant updates, two independent paths (shared across all mounted lists):
  // 1. postgres_changes: the database itself streams every INSERT on messages
  //    (RLS limits events to this owner's chats) — fires on every message, always.
  // 2. broadcast: pushed by the API route as a low-latency extra.
  useEffect(() => {
    if (!ownerId) return;
    return subscribeInbox(ownerId, load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  async function createCategory() {
    const name = newCatName.trim();
    if (!name) return;
    setNewCatOpen(false);
    setNewCatName("");
    await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    load();
  }

  async function deleteCategory(category: Category) {
    setDeletingCat(null);
    if (activeCat === category.id) setActiveCat("all");
    await fetch("/api/categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: category.id }),
    });
    load();
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Check/uncheck a category for every selected chat. */
  async function toggleCategoryForSelected(categoryId: string) {
    if (selected.size === 0 || !chats) return;
    const ids = [...selected];
    const allIn = ids.every(
      (id) => chats.find((c) => c.id === id)?.categories.includes(categoryId)
    );
    await fetch("/api/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatIds: ids, categoryId, member: !allIn }),
    });
    load();
  }

  if (chats === null) {
    return (
      <div className="p-4 space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 animate-pulse">
            <div className="w-12 h-12 rounded-full bg-card2" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-card2 rounded w-1/3" />
              <div className="h-3 bg-card2 rounded w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="p-8 text-center flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-2xl ig-gradient glow-accent flex items-center justify-center">
          <IconLink className="w-6 h-6 text-white" />
        </div>
        <p className="font-semibold">No chats yet</p>
        <p className="text-muted text-sm">
          Create an invite link and share it — anyone who opens it can chat
          with you instantly.
        </p>
        <Link
          href="/invites"
          className="mt-2 bg-accent text-white font-semibold text-sm rounded-xl px-5 py-2.5"
        >
          Create invite link
        </Link>
      </div>
    );
  }

  const visibleChats =
    activeCat === "all"
      ? chats
      : chats.filter((c) => c.categories.includes(activeCat));

  return (
    <div>
      {/* Category tabs + multi-select — desktop web view only */}
      <div className="hidden lg:block px-3 pb-2 space-y-2">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveCat("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-colors ${
              activeCat === "all"
                ? "bg-accent text-white"
                : "bg-card2 border border-line text-muted hover:text-fg"
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <span key={cat.id} className="relative shrink-0 group/cat">
              <button
                onClick={() => setActiveCat(cat.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  activeCat === cat.id
                    ? "bg-accent text-white pr-7"
                    : "bg-card2 border border-line text-muted hover:text-fg"
                }`}
              >
                {cat.name}
              </button>
              {activeCat === cat.id && (
                <button
                  onClick={() => setDeletingCat(cat)}
                  aria-label={`Delete category ${cat.name}`}
                  title="Delete category"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 rounded-full bg-white/20 text-white text-[10px] flex items-center justify-center hover:bg-white/35"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          <button
            onClick={() => setNewCatOpen(true)}
            aria-label="New category"
            title="New category"
            className="w-7 h-7 rounded-full bg-card2 border border-line text-muted hover:text-fg flex items-center justify-center shrink-0"
          >
            <IconPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            className={`ml-auto px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-colors ${
              selectMode
                ? "bg-accent text-white"
                : "bg-card2 border border-line text-muted hover:text-fg"
            }`}
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
        </div>

        {selectMode && (
          <div className="rounded-xl bg-card border border-line p-3 space-y-2 fade-up">
            <p className="text-xs font-semibold text-accent">
              {selected.size} chat{selected.size === 1 ? "" : "s"} selected
            </p>
            {categories.length === 0 ? (
              <p className="text-xs text-muted">
                No categories yet. Create one with the + button above.
              </p>
            ) : selected.size === 0 ? (
              <p className="text-xs text-muted">
                Tap chats below, then check their categories.
              </p>
            ) : (
              <ul className="space-y-1">
                {categories.map((cat) => {
                  const ids = [...selected];
                  const inCount = ids.filter((id) =>
                    chats.find((c) => c.id === id)?.categories.includes(cat.id)
                  ).length;
                  const allIn = inCount === ids.length;
                  const someIn = inCount > 0 && !allIn;
                  return (
                    <li key={cat.id}>
                      <button
                        onClick={() => toggleCategoryForSelected(cat.id)}
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
                        <span className="text-sm font-medium truncate">{cat.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {visibleChats.length === 0 ? (
        <p className="px-5 py-8 text-center text-muted text-sm">
          No chats in this category yet. Use Select to add some.
        </p>
      ) : (
        <ul className="px-2 space-y-0.5">
          {visibleChats.map((chat) => {
            const active = pathname === `/inbox/${chat.id}`;
            const checked = selected.has(chat.id);
            return (
              <li key={chat.id}>
                <Link
                  href={`/inbox/${chat.id}`}
                  onClick={(e) => {
                    if (selectMode) {
                      e.preventDefault();
                      toggleSelected(chat.id);
                    }
                  }}
                  className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                    selectMode && checked
                      ? "bg-accent/15 ring-1 ring-accent"
                      : active
                      ? "bg-accent/15"
                      : "hover:bg-card2/70"
                  }`}
                >
                  {active && !selectMode && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-1 rounded-full bg-accent" />
                  )}
                  <div className="ig-ring shrink-0">
                    <div className="w-11 h-11 rounded-full bg-bg flex items-center justify-center text-base font-bold uppercase">
                      {chat.guest_name.slice(0, 1)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[14px] flex items-center gap-1.5 ${
                      chat.unread > 0 && !active ? "font-bold" : "font-semibold"
                    }`}>
                      {chat.guest_name}
                      <span className="text-xs">{countryFlag(chat.guest_country)}</span>
                    </p>
                    <p className={`text-[13px] truncate ${
                      chat.unread > 0 && !active ? "text-fg font-medium" : "text-muted"
                    }`}>
                      {chat.preview?.content ||
                        (chat.preview?.media_type === "image"
                          ? "Photo"
                          : chat.preview?.media_type === "video"
                          ? "Video"
                          : "New chat")}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {selectMode ? (
                      <span
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          checked ? "bg-accent border-accent" : "border-line"
                        }`}
                      >
                        {checked && <IconCheck className="w-3 h-3 text-white" />}
                      </span>
                    ) : (
                      <>
                        <span className="text-muted text-[11px]">
                          {formatTime(chat.last_message_at)}
                        </span>
                        {chat.unread > 0 && !active && (
                          <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent text-white text-[11px] font-bold flex items-center justify-center fade-up">
                            {chat.unread > 99 ? "99+" : chat.unread}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {newCatOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setNewCatOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs bg-card border border-line rounded-2xl p-4 space-y-3 fade-up"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl ig-gradient glow-accent flex items-center justify-center shrink-0">
                <IconFolder className="w-4.5 h-4.5 text-white" />
              </div>
              <p className="font-bold">New category</p>
            </div>
            <input
              autoFocus
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createCategory()}
              placeholder="Category name"
              className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setNewCatOpen(false);
                  setNewCatName("");
                }}
                className="flex-1 bg-card2 border border-line rounded-xl py-2.5 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={createCategory}
                disabled={!newCatName.trim()}
                className="flex-1 bg-accent text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingCat && (
        <ConfirmDialog
          title="Delete category"
          message={`Delete "${deletingCat.name}"? The chats themselves stay.`}
          onConfirm={() => deleteCategory(deletingCat)}
          onCancel={() => setDeletingCat(null)}
        />
      )}
    </div>
  );
}
