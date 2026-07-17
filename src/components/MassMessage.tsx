"use client";

import { useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { fileKind } from "@/lib/utils";
import Portal from "./Portal";
import { IconCheck, IconFolder, IconSend, IconUser } from "./Icons";

type ChatRow = {
  id: string;
  guest_name: string;
  custom_name: string | null;
  categories: string[];
};
type Category = { id: string; name: string };

export default function MassMessage({
  chats,
  categories,
  onlineIds,
  onClose,
}: {
  chats: ChatRow[];
  categories: Category[];
  onlineIds: Set<string>;
  onClose: () => void;
}) {
  const [allUsers, setAllUsers] = useState(true);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [userSearch, setUserSearch] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const nameOf = (c: ChatRow) => c.custom_name || c.guest_name;

  // Resolve the recipient list from the chosen targeting options.
  const recipients = useMemo(() => {
    let candidates: ChatRow[];
    if (allUsers) {
      candidates = chats;
    } else if (selectedCats.size === 0 && selectedUsers.size === 0) {
      // Nothing picked: "online only" on its own means everyone online.
      candidates = onlineOnly ? chats : [];
    } else {
      candidates = chats.filter(
        (c) =>
          c.categories.some((cat) => selectedCats.has(cat)) || selectedUsers.has(c.id)
      );
    }
    return onlineOnly ? candidates.filter((c) => onlineIds.has(c.id)) : candidates;
  }, [allUsers, onlineOnly, selectedCats, selectedUsers, chats, onlineIds]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const list = q ? chats.filter((c) => nameOf(c).toLowerCase().includes(q)) : chats;
    return [...list].sort((a, b) => {
      const ao = onlineIds.has(a.id) ? 0 : 1;
      const bo = onlineIds.has(b.id) ? 0 : 1;
      return ao - bo || nameOf(a).localeCompare(nameOf(b));
    });
  }, [chats, userSearch, onlineIds]);

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  function pickFile(f: File) {
    if (!fileKind(f)) return;
    setFile(f);
  }

  async function send() {
    if (sending || recipients.length === 0) return;
    if (!text.trim() && !file) {
      setError("Write a message or attach media.");
      return;
    }
    setSending(true);
    setError("");
    try {
      let mediaPath: string | null = null;
      let mediaType: string | null = null;
      if (file) {
        const kind = fileKind(file);
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, scope: "chat" }),
        });
        if (!res.ok) throw new Error("Upload failed");
        const { path, token } = await res.json();
        const { error: upErr } = await supabaseBrowser()
          .storage.from("media")
          .uploadToSignedUrl(path, token, file, { cacheControl: "31536000" });
        if (upErr) throw new Error("Upload failed");
        mediaPath = path;
        mediaType = kind;
      }

      const res = await fetch("/api/messages/mass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatIds: recipients.map((c) => c.id),
          content: text,
          mediaPath,
          mediaType,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not send");
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  const previewUrl = file ? URL.createObjectURL(file) : null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 bg-bg flex flex-col fade-up">
        <header className="shrink-0 border-b border-line px-5 py-4 flex items-center justify-between bg-card/80 backdrop-blur">
          <div>
            <p className="font-bold text-lg">Mass message</p>
            <p className="text-muted text-xs">
              Send to {recipients.length} {recipients.length === 1 ? "person" : "people"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-xl bg-card2 border border-line text-muted hover:text-fg flex items-center justify-center"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 lg:p-8">
          <div className="mx-auto w-full max-w-2xl space-y-6">
            {/* Audience */}
            <section className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Send to
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setAllUsers(true)}
                  className={`px-3.5 py-2 rounded-full text-sm font-semibold transition-colors ${
                    allUsers
                      ? "bg-accent text-white"
                      : "bg-card2 border border-line text-muted hover:text-fg"
                  }`}
                >
                  All users
                </button>
                <button
                  onClick={() => setAllUsers(false)}
                  className={`px-3.5 py-2 rounded-full text-sm font-semibold transition-colors ${
                    !allUsers
                      ? "bg-accent text-white"
                      : "bg-card2 border border-line text-muted hover:text-fg"
                  }`}
                >
                  Choose who
                </button>
                <button
                  onClick={() => setOnlineOnly((v) => !v)}
                  className={`ml-auto flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-semibold transition-colors ${
                    onlineOnly
                      ? "bg-green-500/20 border border-green-500/40 text-green-400"
                      : "bg-card2 border border-line text-muted hover:text-fg"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  Online only
                </button>
              </div>
            </section>

            {/* Fine targeting (hidden when "all users") */}
            {!allUsers && (
              <>
                {categories.length > 0 && (
                  <section className="space-y-3">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                      Categories
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {categories.map((cat) => {
                        const on = selectedCats.has(cat.id);
                        return (
                          <button
                            key={cat.id}
                            onClick={() => setSelectedCats((s) => toggle(s, cat.id))}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                              on
                                ? "bg-accent text-white"
                                : "bg-card2 border border-line text-muted hover:text-fg"
                            }`}
                          >
                            <IconFolder className="w-3.5 h-3.5" />
                            {cat.name}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                      People
                    </p>
                    {selectedUsers.size > 0 && (
                      <button
                        onClick={() => setSelectedUsers(new Set())}
                        className="text-xs text-muted hover:text-fg"
                      >
                        Clear ({selectedUsers.size})
                      </button>
                    )}
                  </div>
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search people…"
                    className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
                  />
                  <div className="max-h-64 overflow-y-auto rounded-xl border border-line divide-y divide-line/50">
                    {filteredUsers.map((c) => {
                      const on = selectedUsers.has(c.id);
                      const online = onlineIds.has(c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() => setSelectedUsers((s) => toggle(s, c.id))}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-card2 transition-colors text-left"
                        >
                          <span className="relative shrink-0">
                            <span className="w-9 h-9 rounded-full bg-bg flex items-center justify-center font-bold uppercase text-sm">
                              {nameOf(c).slice(0, 1)}
                            </span>
                            {online && (
                              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-bg" />
                            )}
                          </span>
                          <span className="flex-1 min-w-0 text-sm font-medium truncate">
                            {nameOf(c)}
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
                    {filteredUsers.length === 0 && (
                      <p className="px-3 py-4 text-sm text-muted text-center">
                        No people found.
                      </p>
                    )}
                  </div>
                </section>
              </>
            )}

            {/* Message */}
            <section className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Message
              </p>
              {previewUrl && (
                <div className="relative inline-block">
                  {fileKind(file!) === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt=""
                      className="max-h-40 rounded-xl border border-line"
                    />
                  ) : (
                    <video
                      src={previewUrl}
                      className="max-h-40 rounded-xl border border-line"
                      muted
                    />
                  )}
                  <button
                    onClick={() => setFile(null)}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-card border border-line text-muted hover:text-fg flex items-center justify-center text-xs"
                  >
                    ✕
                  </button>
                </div>
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Write your message…"
                rows={3}
                className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none resize-none"
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                hidden
                onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="text-sm font-semibold text-accent hover:opacity-80"
              >
                {file ? "Change media" : "+ Attach image or video"}
              </button>
              {error && <p className="text-red-400 text-sm">{error}</p>}
            </section>
          </div>
        </div>

        <div className="shrink-0 border-t border-line p-4 bg-card/60">
          <div className="mx-auto w-full max-w-2xl">
            <button
              onClick={send}
              disabled={sending || recipients.length === 0}
              className="w-full flex items-center justify-center gap-2 bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-40 active:opacity-80 transition-opacity"
            >
              <IconSend className="w-4.5 h-4.5" />
              {sending
                ? "Sending…"
                : `Send to ${recipients.length} ${
                    recipients.length === 1 ? "person" : "people"
                  }`}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
