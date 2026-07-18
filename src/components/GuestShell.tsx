"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import GuestNav from "./GuestNav";
import { GuestShellProvider } from "./GuestShellContext";
import { useInboxSignals } from "@/lib/useInboxSignals";
import GuestChatList, { type GuestChatRow } from "./GuestChatList";
import GuestProfileEditor from "./GuestProfileEditor";
import FollowButton from "./FollowButton";
import PostFeed, { type FeedPost } from "./PostFeed";
import { mediaUrl } from "@/lib/utils";
import { IconUser, IconVerified } from "./Icons";

type Suggestion = {
  ownerId: string;
  name: string;
  avatarPath: string | null;
  verified: boolean;
};

type Bootstrap = {
  profile: { name: string; avatarPath: string | null };
  chats: GuestChatRow[];
  unread: number;
  home: {
    suggestions: Suggestion[];
    posts: FeedPost[];
    canInteract: boolean;
  };
};

// Survives navigating away to /chat or /p/... and back — no cold reload.
let cached: Bootstrap | null = null;
let inflight: Promise<Bootstrap | null> | null = null;

async function loadBootstrap(): Promise<Bootstrap | null> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = fetch("/api/guest/bootstrap")
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as Bootstrap;
      cached = data;
      return data;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function invalidateGuestBootstrap() {
  cached = null;
}

function PanelShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="lg:hidden sticky top-0 z-30 border-b border-line2 bg-card/80 backdrop-blur-lg px-4 py-3">
        <h1 className="max-w-lg mx-auto font-bold text-lg">{title}</h1>
      </header>
      <div className="mx-auto max-w-lg lg:max-w-2xl lg:px-8 lg:pt-8">
        <h1 className="hidden lg:flex items-center gap-1 font-bold text-2xl mb-4">
          {title}
        </h1>
        <div className="lg:bg-card lg:border lg:border-line lg:rounded-2xl lg:overflow-hidden">
          {children}
        </div>
      </div>
    </>
  );
}

function HomePanel({ data }: { data: Bootstrap["home"] }) {
  return (
    <PanelShell title="Home">
      {data.suggestions.length > 0 && (
        <section className="px-4 pt-4 space-y-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">
            Suggested for you
          </p>
          {data.suggestions.map((s) => (
            <div
              key={s.ownerId}
              className="flex items-center gap-3 rounded-2xl border border-line2 bg-card p-3"
            >
              <Link
                href={`/p/${s.ownerId}`}
                className="flex items-center gap-3 min-w-0 flex-1"
              >
                {s.avatarPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(s.avatarPath)}
                    alt={s.name}
                    className="w-10 h-10 rounded-full object-cover bg-bg shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-card2 flex items-center justify-center shrink-0">
                    <IconUser className="w-5 h-5 text-muted" />
                  </div>
                )}
                <span className="font-semibold text-sm truncate flex items-center gap-1">
                  {s.name}
                  {s.verified && (
                    <IconVerified className="w-4 h-4 text-sky-500 shrink-0" />
                  )}
                </span>
              </Link>
              <FollowButton ownerId={s.ownerId} initialFollowing={false} small />
            </div>
          ))}
        </section>
      )}
      {data.posts.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="font-semibold mb-1">No posts yet</p>
          <p className="text-sm text-muted">
            Follow creators to see their latest photos and videos here.
          </p>
        </div>
      ) : (
        <PostFeed posts={data.posts} canInteract={data.canInteract} />
      )}
    </PanelShell>
  );
}

/**
 * Persistent fan shell: Home, Chats and Profile stay mounted and only toggle
 * visibility, so footer/sidebar switches are instant after the first load.
 */
export default function GuestShell() {
  const pathname = usePathname();
  const router = useRouter();
  const [data, setData] = useState<Bootstrap | null>(cached);
  const [loading, setLoading] = useState(!cached);
  // Track visited tabs in state so React re-renders when a new tab mounts.
  const [visited, setVisited] = useState<Set<string>>(() => {
    const t =
      pathname === "/chats"
        ? "chats"
        : pathname === "/profile"
        ? "profile"
        : "home";
    return new Set([t]);
  });

  const tab =
    pathname === "/chats"
      ? "chats"
      : pathname === "/profile"
      ? "profile"
      : "home";

  // Once bootstrap lands, mount every tab so later switches are pure show/hide.
  useEffect(() => {
    if (!data) return;
    setVisited(new Set(["home", "chats", "profile"]));
  }, [data]);

  const refresh = useCallback(() => {
    cached = null;
    loadBootstrap().then((next) => {
      if (next) setData(next);
    });
  }, []);

  /** Optimistically clear one chat's badge and persist that to Supabase. */
  const clearChatUnread = useCallback((chatId: string) => {
    setData((prev) => {
      if (!prev) return prev;
      const chat = prev.chats.find((c) => c.id === chatId);
      if (!chat || chat.unread === 0) return prev;
      const next = {
        ...prev,
        unread: Math.max(0, prev.unread - chat.unread),
        chats: prev.chats.map((c) =>
          c.id === chatId ? { ...c, unread: 0 } : c
        ),
      };
      cached = next;
      return next;
    });
    // /api/guest/open also marks it read; this covers any other caller.
    fetch("/api/guest/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
    }).catch(() => {});
  }, []);

  // Every message send broadcasts a realtime signal — reload the shell data
  // the moment one lands in any of this guest's chats, so the footer badge
  // and the chat list update instantly.
  useInboxSignals(
    (data?.chats ?? []).map((c) => ({ chatId: c.id, ownerId: c.ownerId })),
    refresh
  );

  useEffect(() => {
    let alive = true;
    if (cached) {
      setData(cached);
      setLoading(false);
      // Quiet background refresh — UI stays instant from cache.
      cached = null;
      loadBootstrap().then((next) => {
        if (alive && next) setData(next);
      });
      return () => {
        alive = false;
      };
    }
    setLoading(true);
    loadBootstrap().then((next) => {
      if (!alive) return;
      if (!next) {
        router.replace("/login");
        return;
      }
      setData(next);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [router]);

  useEffect(() => {
    router.prefetch("/home");
    router.prefetch("/chats");
    router.prefetch("/profile");
  }, [router]);

  return (
    <GuestShellProvider
      value={{
        hasShell: true,
        unread: data?.unread ?? 0,
        refresh,
        clearChatUnread,
      }}
    >
      <div className="min-h-dvh pb-[calc(88px+env(safe-area-inset-bottom))] lg:pb-10 lg:pl-60">
        {loading || !data ? (
          <div className="px-6 py-20 text-center text-muted text-sm">Loading…</div>
        ) : (
          <>
            {visited.has("home") && (
              <div
                className={tab === "home" ? "block" : "hidden"}
                aria-hidden={tab !== "home"}
              >
                <HomePanel data={data.home} />
              </div>
            )}
            {visited.has("chats") && (
              <div
                className={tab === "chats" ? "block" : "hidden"}
                aria-hidden={tab !== "chats"}
              >
                <PanelShell title="Chats">
                  <GuestChatList
                    chats={data.chats}
                    onOpenChat={clearChatUnread}
                  />
                </PanelShell>
              </div>
            )}
            {visited.has("profile") && (
              <div
                className={tab === "profile" ? "block" : "hidden"}
                aria-hidden={tab !== "profile"}
              >
                <PanelShell title="Profile">
                  <GuestProfileEditor
                    initialName={data.profile.name}
                    initialAvatarPath={data.profile.avatarPath}
                  />
                </PanelShell>
              </div>
            )}
          </>
        )}
        <GuestNav />
      </div>
    </GuestShellProvider>
  );
}
