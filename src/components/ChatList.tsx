"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { formatTime } from "@/lib/utils";
import { chatPreviewLabel, type ChatPreview } from "@/lib/chatPreview";
import { subscribeGuestPresence } from "@/lib/guestPresence";
import { IconCard, IconCheck, IconEdit, IconFolder, IconGrid, IconLink, IconPlus, IconSearch, IconSend, IconTrash } from "./Icons";
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
  /** Card on file → the fan can one-tap purchase (credit-card icon). */
  stripe_payment_method_id: string | null;
  invites: { label: string | null; code: string } | null;
  preview: ChatPreview | null;
  unread: number;
  categories: string[];
};

type InboxMessagePayload = {
  chatId?: string;
  content?: string | null;
  media_type?: string | null;
  created_at?: string;
  sender?: string;
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

// How many recent chats to render (0 = all). Big audiences (1000+ chats)
// make the list heavy to re-render on every 5s refresh, so cap it by default.
const LIST_LIMIT_KEY = "loly_chat_list_limit";
const DEFAULT_LIST_LIMIT = 100;

function readStoredListLimit(): number {
  if (typeof window === "undefined") return DEFAULT_LIST_LIMIT;
  try {
    const raw = localStorage.getItem(LIST_LIMIT_KEY);
    if (raw === null) return DEFAULT_LIST_LIMIT;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LIST_LIMIT;
  } catch {
    return DEFAULT_LIST_LIMIT;
  }
}

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
const inboxListeners = new Set<(payload?: InboxMessagePayload) => void>();
const typingListeners = new Set<(chatId: string) => void>();

function ensureInboxChannel(ownerId: string) {
  if (inboxChannel && inboxChannelOwner === ownerId) return;
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
    .on("broadcast", { event: "new-message" }, ({ payload }) =>
      inboxListeners.forEach((listener) =>
        listener(payload as InboxMessagePayload | undefined)
      )
    )
    // Fans typing in their chat → animated dots on the chat list row.
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      const p = payload as { chatId?: string; sender?: string };
      if (p.chatId && p.sender === "guest") {
        typingListeners.forEach((listener) => listener(p.chatId!));
      }
    })
    .subscribe((status) => {
      // Recreate the channel if Realtime drops — otherwise new-message
      // signals stop forever until a full page reload.
      if (
        (status === "CHANNEL_ERROR" || status === "TIMED_OUT") &&
        inboxChannelOwner === ownerId
      ) {
        const dead = inboxChannel;
        inboxChannel = null;
        inboxChannelOwner = null;
        if (dead) supabase.removeChannel(dead);
        if (inboxListeners.size > 0 || typingListeners.size > 0) {
          setTimeout(() => ensureInboxChannel(ownerId), 1000);
        }
      }
    });
}

function subscribeInbox(
  ownerId: string,
  onEvent: (payload?: InboxMessagePayload) => void
): () => void {
  ensureInboxChannel(ownerId);
  inboxListeners.add(onEvent);
  return () => {
    inboxListeners.delete(onEvent);
  };
}

function subscribeInboxTyping(
  ownerId: string,
  onTyping: (chatId: string) => void
): () => void {
  ensureInboxChannel(ownerId);
  typingListeners.add(onTyping);
  return () => {
    typingListeners.delete(onTyping);
  };
}

export default function ChatList() {
  const [chats, setChats] = useState<ChatRow[] | null>(chatsCache);
  const [ownerId, setOwnerId] = useState<string | null>(ownerIdCache);
  const [categories, setCategories] = useState<Category[]>(categoriesCache ?? []);
  // "all" or a category id
  const [activeCat, setActiveCat] = useState<string>("all");
  // Name / country / link search — matches across every chat, not just the
  // active category, so a fan is always findable.
  const [search, setSearch] = useState("");
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
  // How many recent chats to render (0 = all) — creator-tunable, persisted.
  const [listLimit, setListLimit] = useState<number>(readStoredListLimit);
  const [massOpen, setMassOpen] = useState(false);
  // Chats whose fan is typing right now (each entry auto-clears after 3s).
  const [typingIds, setTypingIds] = useState<Set<string>>(new Set());
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pathname = usePathname();
  const router = useRouter();
  const mountedRef = useRef(true);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    const chatsRes = await fetch("/api/chats").catch(() => null);
    if (!chatsRes) return;
    if (chatsRes.ok) {
      const { chats, ownerId, categories } = await chatsRes.json();
      // Always refresh the module cache — even if this instance is mid-navigation
      // or unmounting — so the next mount / sibling sidebar paints fresh data.
      chatsCache = chats;
      ownerIdCache = ownerId;
      categoriesCache = categories;
      try {
        localStorage.setItem(INBOX_CACHE_KEY, JSON.stringify({ chats, ownerId, categories }));
      } catch {
        // Storage full or unavailable; the app still works, just without instant paint.
      }
      if (!mountedRef.current) return;
      setChats(chats);
      setOwnerId(ownerId);
      setCategories(categories);
    } else if (chatsRes.status === 401) {
      try {
        localStorage.removeItem(INBOX_CACHE_KEY);
      } catch {}
    }
  }
  loadRef.current = load;

  /** Coalesce bursts of realtime events into one refetch. */
  function scheduleLoad() {
    if (reloadTimerRef.current) return;
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      loadRef.current();
    }, 250);
  }

  /** Instant preview bump so rows don't stick on "New chat" while /api/chats runs. */
  function applyInboxPreview(payload?: InboxMessagePayload) {
    const chatId = payload?.chatId;
    if (!chatId) return;
    const preview: ChatPreview = {
      content: payload.content ?? null,
      media_type: payload.media_type ?? null,
    };
    const hasPreview =
      !!(preview.content && preview.content.trim()) || !!preview.media_type;
    const at = payload.created_at || new Date().toISOString();
    const bump = (list: ChatRow[] | null) => {
      if (!list) return list;
      const idx = list.findIndex((c) => c.id === chatId);
      if (idx < 0) return list;
      const current = list[idx];
      const next: ChatRow = {
        ...current,
        last_message_at: at,
        preview: hasPreview ? preview : current.preview,
        unread:
          payload.sender === "guest" && !pathname?.includes(chatId)
            ? (current.unread || 0) + 1
            : current.unread,
      };
      const copy = list.slice();
      copy.splice(idx, 1);
      copy.unshift(next);
      return copy;
    };
    setChats((prev) => {
      const next = bump(prev);
      if (next) chatsCache = next;
      return next;
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  // Refetch on mount / navigation, and keep polling while the tab is visible
  // so previews never go stale if a realtime signal is missed.
  useEffect(() => {
    loadRef.current();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") loadRef.current();
    }, 5000);
    function onVisible() {
      if (document.visibilityState === "visible") loadRef.current();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Instant updates, two independent paths (shared across all mounted lists):
  // 1. postgres_changes: the database itself streams every INSERT on messages
  //    (RLS limits events to this owner's chats) — fires on every message, always.
  // 2. broadcast: pushed by the API route as a low-latency extra (also carries
  //    a preview so the row updates before the full /api/chats refetch).
  useEffect(() => {
    if (!ownerId) return;
    return subscribeInbox(ownerId, (payload) => {
      applyInboxPreview(payload);
      scheduleLoad();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, pathname]);

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, []);

  // Live online status for guests (green dots + the "Online" filter).
  useEffect(() => {
    if (!ownerId) return;
    return subscribeGuestPresence(ownerId, setOnlineIds);
  }, [ownerId]);

  // Typing animation on the rows: fans send throttled typing pings (~1.5s),
  // so each ping keeps the animation alive for 3s.
  useEffect(() => {
    if (!ownerId) return;
    const timers = typingTimersRef.current;
    const unsubscribe = subscribeInboxTyping(ownerId, (chatId) => {
      setTypingIds((prev) => {
        if (prev.has(chatId)) return prev;
        const next = new Set(prev);
        next.add(chatId);
        return next;
      });
      const old = timers.get(chatId);
      if (old) clearTimeout(old);
      timers.set(
        chatId,
        setTimeout(() => {
          timers.delete(chatId);
          setTypingIds((prev) => {
            const next = new Set(prev);
            next.delete(chatId);
            return next;
          });
        }, 3000)
      );
    });
    return () => {
      unsubscribe();
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
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

  function updateListLimit(raw: string) {
    const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
    const next = Number.isFinite(n) && n >= 0 ? n : 0;
    setListLimit(next);
    try {
      localStorage.setItem(LIST_LIMIT_KEY, String(next));
    } catch {}
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

  const query = search.trim().toLowerCase();
  const matchesSearch = (c: ChatRow) =>
    [
      c.custom_name,
      c.guest_name,
      c.guest_country,
      c.invites?.label,
      c.invites?.code,
    ].some((field) => field?.toLowerCase().includes(query));

  // Main section: chats marked for "All" plus safety net for uncategorized
  // ones. A search looks through every chat instead, so fans in other
  // categories still turn up.
  const filteredChats = (
    query
      ? chats.filter(matchesSearch)
      : activeCat === "all"
      ? chats.filter((c) => c.in_all || c.categories.length === 0)
      : chats.filter((c) => c.categories.includes(activeCat))
  ).filter((c) => !onlineOnly || onlineIds.has(c.id));

  // Cap what's rendered: with big audiences the full list makes every 5s
  // refresh repaint thousands of rows. Unread badges still count everything.
  const visibleChats =
    listLimit > 0 ? filteredChats.slice(0, listLimit) : filteredChats;
  const hiddenCount = filteredChats.length - visibleChats.length;

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
      {/* Search: name, renamed name, country or invite link — mobile + desktop */}
      <div className="px-3 pb-2">
        <div className="relative">
          <IconSearch className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="search"
            placeholder="Search chats"
            aria-label="Search chats"
            className="w-full bg-card2 border border-line rounded-xl pl-9 pr-9 py-2 text-sm placeholder:text-muted focus:border-accent outline-none transition-colors [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg text-muted hover:text-fg flex items-center justify-center"
            >
              ✕
            </button>
          )}
        </div>
      </div>

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

        {/* Actions row: swipe/scroll sideways when pills don't fit */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none touch-pan-x">
          <button
            onClick={() => setNewCatOpen(true)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-card2 border border-line text-muted hover:text-fg transition-colors"
          >
            <IconPlus className="w-3.5 h-3.5" />
            New category
          </button>
          <button
            onClick={() => setOnlineOnly((v) => !v)}
            title="Show only guests who are online"
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
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
          <label
            title="How many recent chats to display (empty = all)"
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-card2 border border-line text-muted"
          >
            Show
            <input
              value={listLimit > 0 ? String(listLimit) : ""}
              onChange={(e) => updateListLimit(e.target.value)}
              inputMode="numeric"
              placeholder="All"
              className="w-11 bg-transparent text-fg text-center outline-none border-b border-line focus:border-accent placeholder:text-muted"
            />
          </label>
          <button
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
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
          {query
            ? `No chats match “${search.trim()}”.`
            : onlineOnly
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
                  // Prevent the browser from starting a link-drag when the
                  // creator scrolls the list with click-and-drag / trackpad.
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  onClick={(e) => {
                    if (selectMode) {
                      e.preventDefault();
                      toggleSelected(chat.id);
                    }
                  }}
                  className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors select-none [-webkit-user-drag:none] ${
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
                      {chat.stripe_payment_method_id ? (
                        <span title="Card registered" className="shrink-0 text-accent">
                          <IconCard className="w-3.5 h-3.5" />
                        </span>
                      ) : null}
                      <span className="truncate">{displayName}</span>
                      {chat.custom_name && (
                        <span className="text-muted text-[11px] font-normal truncate">
                          {chat.guest_name}
                        </span>
                      )}
                    </p>
                    {typingIds.has(chat.id) ? (
                      <p className="text-[13px] text-accent font-medium flex items-center gap-1.5">
                        typing
                        <span className="flex items-center gap-0.5">
                          <span className="typing-dot w-1 h-1 rounded-full bg-accent" />
                          <span className="typing-dot w-1 h-1 rounded-full bg-accent" />
                          <span className="typing-dot w-1 h-1 rounded-full bg-accent" />
                        </span>
                      </p>
                    ) : (
                      <p className={`text-[13px] truncate ${
                        chat.unread > 0 && !active ? "text-fg font-medium" : "text-muted"
                      }`}>
                        {chatPreviewLabel(chat.preview)}
                      </p>
                    )}
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

      {hiddenCount > 0 && (
        <div className="px-3 py-3 text-center space-y-1.5">
          <p className="text-muted text-xs">
            Showing the {visibleChats.length} most recent of {filteredChats.length}{" "}
            {query ? "matching chats" : "chats"}
          </p>
          <button
            onClick={() => updateListLimit("0")}
            className="text-accent text-xs font-semibold hover:opacity-80"
          >
            Show all
          </button>
        </div>
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
