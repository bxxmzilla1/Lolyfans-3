"use client";

import { useMemo, useState } from "react";
import Portal from "./Portal";
import AdminCodeDialog from "./AdminCodeDialog";
import { IconCheck, IconSearch, IconTrash } from "./Icons";

type ChatRow = {
  id: string;
  guest_name: string;
  custom_name: string | null;
  guest_country: string | null;
};

/**
 * Delete every chat at once, minus the people the creator ticks to keep.
 * Destructive, so it ends on the admin-code dialog like a single delete.
 */
export default function MassDeleteChats({
  chats,
  onlineIds,
  onClose,
  onDeleted,
}: {
  chats: ChatRow[];
  onlineIds: Set<string>;
  onClose: () => void;
  onDeleted: (deleted: number) => void;
}) {
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [askCode, setAskCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const nameOf = (c: ChatRow) => c.custom_name || c.guest_name;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? chats.filter((c) =>
          [c.custom_name, c.guest_name, c.guest_country].some((f) =>
            f?.toLowerCase().includes(q)
          )
        )
      : chats;
    // Kept people float to the top so the exclusion list is always in view.
    return [...list].sort((a, b) => {
      const ak = keep.has(a.id) ? 0 : 1;
      const bk = keep.has(b.id) ? 0 : 1;
      return ak - bk || nameOf(a).localeCompare(nameOf(b));
    });
  }, [chats, search, keep]);

  const deleteCount = chats.length - keep.size;

  function toggle(id: string) {
    setKeep((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runDelete(code: string) {
    setAskCode(false);
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/chats/mass-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, excludeChatIds: [...keep] }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onDeleted(data.deleted ?? 0);
        return;
      }
      setError(data.error || "Could not delete chats");
    } catch {
      setError("Could not delete chats");
    }
    setBusy(false);
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-50 bg-bg flex flex-col fade-up">
        <header className="shrink-0 border-b border-line px-5 py-4 flex items-center justify-between gap-3 bg-card/80 backdrop-blur">
          <div className="min-w-0">
            <p className="font-bold text-lg">Delete all chats</p>
            <p className="text-muted text-xs">
              {deleteCount} of {chats.length} will be deleted
              {keep.size > 0 ? ` · ${keep.size} kept` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 w-9 h-9 rounded-xl bg-card2 border border-line text-muted hover:text-fg flex items-center justify-center"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 lg:p-8">
          <div className="mx-auto w-full max-w-2xl space-y-4">
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-3">
              <p className="text-sm font-semibold text-red-400">
                This permanently deletes the chats and all their messages.
              </p>
              <p className="text-xs text-muted mt-1">
                Tick anyone you want to keep — everyone else is removed. This
                can&apos;t be undone.
              </p>
            </div>

            <div className="relative">
              <IconSearch className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search people to keep…"
                className="w-full bg-card2 border border-line rounded-xl pl-9 pr-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
              />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Keep these people
              </p>
              {keep.size > 0 && (
                <button
                  onClick={() => setKeep(new Set())}
                  className="text-xs text-muted hover:text-fg"
                >
                  Clear ({keep.size})
                </button>
              )}
            </div>

            <div className="rounded-xl border border-line divide-y divide-line/50 overflow-hidden">
              {visible.map((c) => {
                const on = keep.has(c.id);
                const online = onlineIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      on ? "bg-accent/10" : "hover:bg-card2"
                    }`}
                  >
                    <span className="relative shrink-0">
                      <span className="w-9 h-9 rounded-full bg-bg flex items-center justify-center font-bold uppercase text-sm">
                        {nameOf(c).slice(0, 1)}
                      </span>
                      {online && (
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-bg" />
                      )}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">
                        {nameOf(c)}
                      </span>
                      <span
                        className={`block text-xs ${
                          on ? "text-accent" : "text-muted"
                        }`}
                      >
                        {on ? "Kept" : "Will be deleted"}
                      </span>
                    </span>
                    <span
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${
                        on ? "bg-accent border-accent" : "border-line"
                      }`}
                    >
                      {on && <IconCheck className="w-3 h-3 text-white" />}
                    </span>
                  </button>
                );
              })}
              {visible.length === 0 && (
                <p className="px-3 py-4 text-sm text-muted text-center">
                  No people found.
                </p>
              )}
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}
          </div>
        </div>

        <div className="shrink-0 border-t border-line p-4 bg-card/60">
          <div className="mx-auto w-full max-w-2xl">
            <button
              onClick={() => setAskCode(true)}
              disabled={busy || deleteCount === 0}
              className="w-full flex items-center justify-center gap-2 bg-red-500 text-white font-semibold rounded-xl py-3 disabled:opacity-40 active:opacity-80 transition-opacity"
            >
              <IconTrash className="w-4.5 h-4.5" />
              {busy
                ? "Deleting…"
                : deleteCount === 0
                  ? "Everyone is kept"
                  : `Delete ${deleteCount} ${deleteCount === 1 ? "chat" : "chats"}`}
            </button>
          </div>
        </div>

        {askCode && (
          <AdminCodeDialog
            title="Delete all chats"
            message={`Enter the admin code to permanently delete ${deleteCount} ${
              deleteCount === 1 ? "chat" : "chats"
            }${keep.size > 0 ? ` and keep ${keep.size}` : ""}. This can't be undone.`}
            onVerified={(code) => void runDelete(code)}
            onCancel={() => setAskCode(false)}
          />
        )}
      </div>
    </Portal>
  );
}
