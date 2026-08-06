"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatTime } from "@/lib/utils";
import {
  cpmEarnedCents,
  cpmSessionLive,
  formatCpmDollars,
} from "@/lib/cpmShared";
import { IconStar, IconTrash } from "./Icons";

type CpmSession = {
  startedAt: string;
  lastActiveAt: string;
  minutesCharged: number;
  live: boolean;
};

type CpmChat = {
  id: string;
  guest_name: string;
  custom_name: string | null;
  last_message_at: string;
  hasCard: boolean;
  unread: number;
  preview: { content: string | null; media_type: string | null } | null;
  session: CpmSession | null;
};

function previewLabel(p: CpmChat["preview"]): string {
  if (!p) return "Chat per minute";
  if (p.content?.trim()) return p.content;
  if (p.media_type === "video") return "Video";
  if (p.media_type === "image") return "Photo";
  if (p.media_type === "audio") return "Voice note";
  return "Chat per minute";
}

/**
 * Sidebar section for Chat-per-minute fans — purple rows with a gold star
 * beside the name so they're easy to spot next to Telegram DMs. Live
 * sessions show Active + accruing session earnings.
 */
export default function CpmChatList() {
  const pathname = usePathname();
  const [chats, setChats] = useState<CpmChat[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inflight = useRef(false);
  const lastFp = useRef("");

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await fetch("/api/cpm/chats");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const next = (data.chats ?? []) as CpmChat[];
        // Fingerprint without wall-clock fields that we tick locally.
        const fp = JSON.stringify(
          next.map((c) => ({
            id: c.id,
            guest_name: c.guest_name,
            custom_name: c.custom_name,
            last_message_at: c.last_message_at,
            unread: c.unread,
            preview: c.preview,
            session: c.session
              ? {
                  startedAt: c.session.startedAt,
                  lastActiveAt: c.session.lastActiveAt,
                  minutesCharged: c.session.minutesCharged,
                }
              : null,
          }))
        );
        if (fp !== lastFp.current) {
          lastFp.current = fp;
          setChats(next);
        } else {
          // Refresh lastActiveAt / live even when the rest is unchanged.
          setChats((prev) => {
            if (!prev) return next;
            return prev.map((c) => {
              const n = next.find((x) => x.id === c.id);
              return n ? { ...c, session: n.session } : c;
            });
          });
        }
      }
    } catch {
      // ignore — next poll retries
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 3000);
    return () => clearInterval(t);
  }, [load]);

  // Tick earnings every second while any session is live.
  useEffect(() => {
    const anyLive = (chats ?? []).some(
      (c) => c.session && cpmSessionLive(c.session.lastActiveAt)
    );
    if (!anyLive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [chats]);

  async function remove(chat: CpmChat) {
    const name = chat.custom_name || chat.guest_name;
    const sure = window.confirm(
      `Delete ${name}? This permanently removes their chat and wipes their account and card details from Stripe and Lolyfans.`
    );
    if (!sure) return;
    setDeletingId(chat.id);
    try {
      const res = await fetch(
        `/api/cpm/chats?chatId=${encodeURIComponent(chat.id)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        lastFp.current = "";
        setChats((prev) => (prev ?? []).filter((c) => c.id !== chat.id));
      }
    } catch {
      // next poll restores the row if the delete didn't go through
    } finally {
      setDeletingId(null);
    }
  }

  if (!chats || chats.length === 0) return null;

  return (
    <div className="border-b border-line pb-2 mb-1">
      <p className="px-5 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-widest text-violet-400">
        Chat per minute
      </p>
      <div className="px-2 space-y-0.5">
        {chats.map((c) => {
          const name = c.custom_name || c.guest_name;
          const active = pathname === `/inbox/${c.id}`;
          const when = c.last_message_at
            ? formatTime(c.last_message_at)
            : "";
          const live =
            !!c.session &&
            (cpmSessionLive(c.session.lastActiveAt, now) || c.session.live);
          const earned = c.session
            ? formatCpmDollars(cpmEarnedCents(c.session.startedAt, now))
            : null;
          return (
            <Link
              key={c.id}
              href={`/inbox/${c.id}`}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                active
                  ? "bg-violet-500/20 ring-1 ring-violet-400/40"
                  : "hover:bg-violet-500/10"
              }`}
            >
              <div className="relative w-11 h-11 rounded-full bg-violet-500/20 text-violet-300 flex items-center justify-center text-base font-bold uppercase shrink-0">
                {name.slice(0, 1)}
                {live && (
                  <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-bg" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <IconStar className="w-3.5 h-3.5 text-amber-400 shrink-0 drop-shadow-[0_0_4px_rgba(251,191,36,0.55)]" />
                  <p
                    className={`text-[14px] truncate flex-1 ${
                      c.unread && !active
                        ? "font-bold text-violet-200"
                        : "font-semibold text-violet-100"
                    }`}
                  >
                    {name}
                  </p>
                  {live && earned ? (
                    <span className="text-[11px] font-bold text-amber-300 tabular-nums shrink-0">
                      {earned}
                    </span>
                  ) : when ? (
                    <span className="text-[11px] text-violet-300/70 shrink-0">
                      {when}
                    </span>
                  ) : null}
                </div>
                <p
                  className={`text-[13px] truncate ${
                    live
                      ? "text-emerald-400 font-medium"
                      : c.unread && !active
                        ? "text-violet-200 font-medium"
                        : "text-violet-300/70"
                  }`}
                >
                  {live
                    ? `Active · ${earned} spent`
                    : previewLabel(c.preview)}
                </p>
              </div>
              {c.unread > 0 && !active && !live && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-violet-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                  {c.unread > 99 ? "99+" : c.unread}
                </span>
              )}
              <button
                type="button"
                aria-label={`Delete ${name}`}
                title="Delete chat, account and card details"
                disabled={deletingId === c.id}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void remove(c);
                }}
                className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-violet-300/50 hover:text-red-400 hover:bg-red-500/10 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-60"
              >
                {deletingId === c.id ? (
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-red-400/40 border-t-red-400 animate-spin" />
                ) : (
                  <IconTrash className="w-4 h-4" />
                )}
              </button>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
