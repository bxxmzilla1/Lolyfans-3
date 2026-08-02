"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatTime } from "@/lib/utils";
import { IconSearch, IconSend, IconUser } from "./Icons";
import TelegramReceipt from "./TelegramReceipt";

type Dialog = {
  peer: string;
  title: string;
  username: string | null;
  kind: "user" | "group" | "channel";
  unread: number;
  preview: string;
  date: number;
  photoUrl: string | null;
  lastOut: boolean;
  lastReceipt: "sent" | "read" | null;
};

function peerHref(peer: string, title: string) {
  const q = title ? `?title=${encodeURIComponent(title)}` : "";
  return `/inbox/tg/${encodeURIComponent(peer)}${q}`;
}

function kindLabel(kind: Dialog["kind"]) {
  if (kind === "channel") return "Channel";
  if (kind === "group") return "Group";
  return null;
}

/**
 * Creator inbox: Telegram DMs, groups and channels from the connected
 * account — so sending PPVs and replies is one tap into the right chat.
 */
export default function TelegramChatList() {
  const pathname = usePathname();
  const [dialogs, setDialogs] = useState<Dialog[] | null>(null);
  const [error, setError] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/telegram/dialogs");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDialogs(data.dialogs ?? []);
        setDisconnected(false);
        setError("");
      } else if (data.disconnected) {
        setDisconnected(true);
        setDialogs([]);
        setError("");
      } else {
        setError(data.error || "Could not load Telegram chats");
      }
    } catch {
      setError("Could not load Telegram chats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 20000);
    return () => clearInterval(timer);
  }, [load]);

  const q = search.trim().toLowerCase();
  const filtered = (dialogs ?? []).filter((d) => {
    if (!q) return true;
    return (
      d.title.toLowerCase().includes(q) ||
      (d.username && d.username.toLowerCase().includes(q)) ||
      d.preview.toLowerCase().includes(q)
    );
  });

  if (loading && !dialogs) {
    return (
      <div className="px-4 py-8 space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 animate-pulse">
            <div className="w-12 h-12 rounded-full bg-card2" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-28 bg-card2 rounded" />
              <div className="h-2.5 w-40 bg-card2 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (disconnected) {
    return (
      <div className="px-5 py-10 text-center space-y-3">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-accent/15 text-accent flex items-center justify-center">
          <IconSend className="w-7 h-7" />
        </div>
        <p className="font-semibold">Connect Telegram</p>
        <p className="text-sm text-muted">
          Open Settings → Telegram and connect your account to see your
          chats and send PPVs from here.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-5 py-10 text-center space-y-3">
        <p className="text-sm text-red-400">{error}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="text-sm font-semibold text-accent"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-2 pb-2">
        <div className="flex items-center gap-2 bg-card2 border border-line rounded-xl px-3 py-2">
          <IconSearch className="w-4 h-4 text-muted shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Telegram…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            {q ? "No chats match your search" : "No Telegram chats yet"}
          </p>
        ) : (
          filtered.map((d) => {
            const href = peerHref(d.peer, d.title);
            const active =
              pathname === `/inbox/tg/${encodeURIComponent(d.peer)}`;
            const when = d.date
              ? formatTime(new Date(d.date * 1000).toISOString())
              : "";
            const kind = kindLabel(d.kind);
            return (
              <Link
                key={d.peer}
                href={href}
                className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                  active ? "bg-accent/10" : "hover:bg-card2"
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-card2 flex items-center justify-center shrink-0 overflow-hidden">
                  {d.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.photoUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <IconUser className="w-5 h-5 text-muted" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm truncate flex-1">
                      {d.title}
                    </p>
                    {when && (
                      <span className="text-[11px] text-muted shrink-0">
                        {when}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {d.lastOut && (
                      <TelegramReceipt receipt={d.lastReceipt} />
                    )}
                    <p className="text-xs text-muted truncate flex-1">
                      {kind ? `${kind} · ` : ""}
                      {d.preview || (d.username ? `@${d.username}` : "Telegram")}
                    </p>
                    {d.unread > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {d.unread > 99 ? "99+" : d.unread}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
