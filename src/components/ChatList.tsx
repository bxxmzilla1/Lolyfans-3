"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { formatTime, messagePreviewText } from "@/lib/utils";
import { subscribeGuestPresence } from "@/lib/guestPresence";
import { IconCheck, IconEdit, IconFolder, IconGrid, IconLink, IconPlus, IconSend, IconTrash } from "./Icons";
import ConfirmDialog from "./ConfirmDialog";
import AdminCodeDialog from "./AdminCodeDialog";
import MassMessage from "./MassMessage";
import Portal from "./Portal";

type ChatRow = {
  id: string;
  guest_name: string;
  custom_name: string | null;
  guest_country: string | null;
  last_message_at: string;
  in_all: boolean;
  invites: { label: string | null; code: string } | null;
  preview: { content: string | null; media_type: string | null } | null;
  unread: number;
  categories: string[];
};

type Category = { id: string; name: string };

// Module-level cache: navigating between pages re-mounts the list,
// so start from the last known data instead of a loading skeleton.
let chatsCache: ChatRow[] | null = null;
let ownerIdCache: string | null = null;
let categoriesCache: Category[] | null = null;

// Persisted copy so a fresh app launch paints instantly from the last known
// inbox while the network request runs. Cleared on logout / auth failure.
export const INBOX_CACHE_KEY = "loly_inbox_v1";

function readStoredInbox(): { chats: ChatRow[]; ownerId: string; categories: Category[] } | null {
  try {
    return JSON.parse(localStorage.getItem(INBOX_CACHE_KEY) || "null");
  } catch {
    return null;
  }
}

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
  const [renaming, setRenaming] = useState<ChatRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Chat pending deletion — the admin code must be entered to confirm.
  const [deletingChat, setDeletingChat] = useState<ChatRow | null>(null);
  // Guests currently viewing their chat, and whether to show only them.
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [massOpen, setMassOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const cancelledRef = useRef(false);

  async function load() {
    const chatsRes = await fetch("/api/chats");
    if (cancelledRef.current) return;
    if (chatsRes.ok) {
      const { chats, ownerId, categories } = await chatsRes.json();
      chatsCache = chats;
      ownerIdCache = ownerId;
      categoriesCache = categories;
      setChats(chats);
      setOwnerId(ownerId);
      setCategories(categories);
      try {
        localStorage.setItem(INBOX_CACHE_KEY, JSON.stringify({ chats, ownerId, categories }));
      } catch {
        // Storage full or unavailable; the app still works, just without instant paint.
      }
    } else if (chatsRes.status === 401) {
      try {
        localStorage.removeItem(INBOX_CACHE_KEY);
      } catch {}
    }
  }

  // Paint instantly from the last persisted inbox on a fresh launch, then let
  // the network refresh replace it.
  useEffect(() => {
    if (chatsCache !== null) return;
    const stored = readStoredInbox();
    if (stored) {
      setChats((current) => current ?? stored.chats);
      setOwnerId((current) => current ?? stored.ownerId);
      setCategories((current) => (current.length ? current : stored.categories));
    }
  }, []);

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

  // Live online status for guests (green dots + the "Online" filter).
  useEffect(() => {
    if (!ownerId) return;
    return subscribeGuestPresence(ownerId, setOnlineIds);
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

  /** Check/uncheck a category (or the built-in "all") for every selected chat. */
  async function toggleCategoryForSelected(categoryId: string) {
    if (selected.size === 0 || !chats) return;
    const ids = [...selected];
    const isIn = (chat: ChatRow | undefined) =>
      categoryId === "all" ? !!chat?.in_all : !!chat?.categories.includes(categoryId);
    const allIn = ids.every((id) => isIn(chats.find((c) => c.id === id)));
    await fetch("/api/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatIds: ids, categoryId, member: !allIn }),
    });
    load();
  }

  async function saveRename() {
    if (!renaming) return;
    const chatId = renaming.id;
    const customName = renameValue.trim();
    setRenaming(null);
    await fetch("/api/chats", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, customName }),
    });
    load();
  }

  async function deleteChat(code: string) {
    if (!deletingChat) return;
    const chatId = deletingChat.id;
    setDeletingChat(null);
    const res = await fetch("/api/chats", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, code }),
    });
    if (res.ok) {
      // If the deleted chat is open, step back to the empty inbox.
      if (pathname === `/inbox/${chatId}`) router.push("/inbox");
      load();
    }
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

  // Main section: chats marked for "All" plus safety net for uncategorized ones
  const visibleChats = (
    activeCat === "all"
      ? chats.filter((c) => c.in_all || c.categories.length === 0)
      : chats.filter((c) => c.categories.includes(activeCat))
  ).filter((c) => !onlineOnly || onlineIds.has(c.id));

  const onlineCount = chats.filter((c) => onlineIds.has(c.id)).length;

  // Unread totals per tab so new messages are visible from any category.
  // The chat that's currently open is excluded (it's being read right now).
  const countable = chats.filter((c) => pathname !== `/inbox/${c.id}`);
  const unreadAll = countable
    .filter((c) => c.in_all || c.categories.length === 0)
    .reduce((sum, c) => sum + c.unread, 0);
  const unreadByCat = new Map<string, number>(
    categories.map((cat) => [
      cat.id,
      countable
        .filter((c) => c.categories.includes(cat.id))
        .reduce((sum, c) => sum + c.unread, 0),
    ])
  );

  const tabBadge = (count: number, activeTab: boolean) =>
    count > 0 && (
      <span
        className={`min-w-4 h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center fade-up ${
          activeTab ? "bg-white text-accent" : "bg-accent text-white"
        }`}
      >
        {count > 99 ? "99+" : count}
      </span>
    );

  return (
    <div>
      {/* Category tabs + multi-select — desktop web view only */}
      <div className="hidden lg:block px-3 pb-2 space-y-2">
        {/* Mass message: prominent, always at the very top */}
        <button
          onClick={() => setMassOpen(true)}
          className="w-full flex items-center justify-center gap-2 bg-accent text-white font-semibold rounded-xl py-2.5 text-sm active:opacity-80 transition-opacity"
        >
          <IconSend className="w-4 h-4" />
          Mass message
        </button>

        {/* Always-visible actions: never scroll away with the category tabs */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setNewCatOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-card2 border border-line text-muted hover:text-fg transition-colors"
          >
            <IconPlus className="w-3.5 h-3.5" />
            New category
          </button>
          <button
            onClick={() => setOnlineOnly((v) => !v)}
            title="Show only guests who are online"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              onlineOnly
                ? "bg-green-500/20 border border-green-500/40 text-green-400"
                : "bg-card2 border border-line text-muted hover:text-fg"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${onlineOnly ? "bg-green-500" : "bg-green-500/70"}`} />
            Online
            {onlineCount > 0 && (
              <span className="text-[10px] opacity-80">{onlineCount}</span>
            )}
          </button>
          <button
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            className={`ml-auto px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              selectMode
                ? "bg-accent text-white"
                : "bg-card2 border border-line text-muted hover:text-fg"
            }`}
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveCat("all")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-colors ${
              activeCat === "all"
                ? "bg-accent text-white"
                : "bg-card2 border border-line text-muted hover:text-fg"
            }`}
          >
            All
            {tabBadge(unreadAll, activeCat === "all")}
          </button>
          {categories.map((cat) => (
            <span key={cat.id} className="relative shrink-0 group/cat">
              <button
                onClick={() => setActiveCat(cat.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  activeCat === cat.id
                    ? "bg-accent text-white pr-7"
                    : "bg-card2 border border-line text-muted hover:text-fg"
                }`}
              >
                {cat.name}
                {tabBadge(unreadByCat.get(cat.id) ?? 0, activeCat === cat.id)}
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
        </div>

        {selectMode && (
          <div className="rounded-xl bg-card border border-line p-3 space-y-2 fade-up">
            <p className="text-xs font-semibold text-accent">
              {selected.size} chat{selected.size === 1 ? "" : "s"} selected
            </p>
            {selected.size === 0 ? (
              <p className="text-xs text-muted">
                Tap chats below, then check where they show.
              </p>
            ) : (
              <ul className="space-y-1">
                {[{ id: "all", name: "All (main section)" }, ...categories].map((cat) => {
                  const ids = [...selected];
                  const inCount = ids.filter((id) => {
                    const chat = chats.find((c) => c.id === id);
                    return cat.id === "all"
                      ? !!chat?.in_all
                      : !!chat?.categories.includes(cat.id);
                  }).length;
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
                        {cat.id === "all" ? (
                          <IconGrid className="w-4 h-4 text-accent shrink-0" />
                        ) : (
                          <IconFolder className="w-4 h-4 text-accent shrink-0" />
                        )}
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
          {onlineOnly
            ? "No one is online right now."
            : "No chats in this category yet. Use Select to add some."}
        </p>
      ) : (
        <ul className="px-2 space-y-0.5">
          {visibleChats.map((chat) => {
            const active = pathname === `/inbox/${chat.id}`;
            const checked = selected.has(chat.id);
            const displayName = chat.custom_name || chat.guest_name;
            return (
              <li key={chat.id} className="group/row relative">
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
                  <div className="relative shrink-0">
                    <div className="ig-ring">
                      <div className="w-11 h-11 rounded-full bg-bg flex items-center justify-center text-base font-bold uppercase">
                        {displayName.slice(0, 1)}
                      </div>
                    </div>
                    {onlineIds.has(chat.id) && (
                      <span
                        className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-card"
                        title="Online now"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[14px] flex items-center gap-1.5 min-w-0 ${
                      chat.unread > 0 && !active ? "font-bold" : "font-semibold"
                    }`}>
                      <span className="truncate">{displayName}</span>
                      {chat.custom_name && (
                        <span className="text-muted text-[11px] font-normal truncate">
                          {chat.guest_name}
                        </span>
                      )}
                    </p>
                    <p className={`text-[13px] truncate ${
                      chat.unread > 0 && !active ? "text-fg font-medium" : "text-muted"
                    }`}>
                      {(chat.preview?.content && messagePreviewText(chat.preview.content)) ||
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
                {!selectMode && (
                  <button
                    onClick={() => {
                      setRenaming(chat);
                      setRenameValue(chat.custom_name ?? "");
                    }}
                    aria-label={`Rename ${displayName}`}
                    title="Rename"
                    className="hidden lg:group-hover/row:flex absolute right-2 top-2 w-6 h-6 rounded-lg bg-card2 border border-line text-muted hover:text-fg items-center justify-center"
                  >
                    <IconEdit className="w-3 h-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {newCatOpen && (
        <Portal>
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
        </Portal>
      )}

      {renaming && (
        <Portal>
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setRenaming(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs bg-card border border-line rounded-2xl p-4 space-y-3 fade-up"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl ig-gradient glow-accent flex items-center justify-center shrink-0">
                <IconEdit className="w-4.5 h-4.5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="font-bold">Rename chat</p>
                <p className="text-muted text-xs truncate">
                  Original name: {renaming.guest_name}
                </p>
              </div>
            </div>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveRename()}
              placeholder={renaming.guest_name}
              className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
            />
            <p className="text-muted text-xs">
              Leave empty to go back to the original name.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setRenaming(null)}
                className="flex-1 bg-card2 border border-line rounded-xl py-2.5 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={saveRename}
                className="flex-1 bg-accent text-white rounded-xl py-2.5 text-sm font-semibold"
              >
                Save
              </button>
            </div>
            <button
              onClick={() => {
                setDeletingChat(renaming);
                setRenaming(null);
              }}
              className="w-full flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl py-2.5 text-sm font-semibold hover:bg-red-500/20 transition-colors"
            >
              <IconTrash className="w-4 h-4" />
              Delete chat
            </button>
          </div>
        </div>
        </Portal>
      )}

      {massOpen && (
        <MassMessage
          chats={chats}
          categories={categories}
          onlineIds={onlineIds}
          onClose={() => setMassOpen(false)}
        />
      )}

      {deletingChat && (
        <AdminCodeDialog
          title="Delete chat"
          message={`Enter the admin code to permanently delete this chat with ${
            deletingChat.custom_name || deletingChat.guest_name
          }. This can't be undone.`}
          onVerified={(code) => deleteChat(code)}
          onCancel={() => setDeletingChat(null)}
        />
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
