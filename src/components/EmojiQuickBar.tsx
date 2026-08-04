"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconEdit, IconPlus } from "./Icons";

const EMOJI_STORE_KEY = "tg-emoji-quickbar";
const DEFAULT_EMOJIS = ["❤️", "😘", "😈", "🔥", "😍", "🥵", "💦", "🍑", "😏", "🙈"];

function loadQuickEmojis(): string[] {
  try {
    const raw = localStorage.getItem(EMOJI_STORE_KEY);
    if (!raw) return DEFAULT_EMOJIS;
    const list = JSON.parse(raw);
    if (Array.isArray(list) && list.every((e) => typeof e === "string")) {
      return list.slice(0, 40);
    }
  } catch {
    // corrupted storage — fall back to defaults
  }
  return DEFAULT_EMOJIS;
}

/**
 * Thin tap-to-insert emoji strip shared by the chat composer and the PPV
 * send sheet. One tap inserts; the pencil toggles edit mode where taps
 * remove and the small input adds. The list persists per device under one
 * localStorage key, so every surface shows the same emojis.
 */
export default function EmojiQuickBar({
  onInsert,
  className = "",
}: {
  onInsert: (emoji: string) => void;
  className?: string;
}) {
  const [emojis, setEmojis] = useState<string[]>(DEFAULT_EMOJIS);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setEmojis(loadQuickEmojis());
  }, []);

  function save(next: string[]) {
    setEmojis(next);
    try {
      localStorage.setItem(EMOJI_STORE_KEY, JSON.stringify(next));
    } catch {
      // storage full/blocked — the bar still works for this session
    }
  }

  function add() {
    const value = draft.trim();
    if (!value) return;
    if (!emojis.includes(value)) save([...emojis, value].slice(0, 40));
    setDraft("");
  }

  return (
    <div className={`pl-2 pr-1.5 py-1.5 flex items-center gap-1 ${className}`}>
      {/* Only the emojis scroll — the add input and pencil stay pinned on
          the right so editing never requires sliding to the end. */}
      <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto scrollbar-none">
        {emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() =>
              edit ? save(emojis.filter((e) => e !== emoji)) : onInsert(emoji)
            }
            title={edit ? "Remove from bar" : `Insert ${emoji}`}
            className={`relative shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-lg transition-colors ${
              edit ? "bg-red-500/10 hover:bg-red-500/25" : "hover:bg-card2"
            }`}
          >
            {emoji}
            {edit && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                ×
              </span>
            )}
          </button>
        ))}
      </div>
      {edit && (
        <div className="shrink-0 flex items-center gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="😀"
            className="w-14 bg-card2 border border-line rounded-lg px-2 py-1 text-sm text-center outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim()}
            aria-label="Add emoji"
            className="w-7 h-7 rounded-lg bg-accent/15 text-accent flex items-center justify-center disabled:opacity-40"
          >
            <IconPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          setEdit((v) => !v);
          setDraft("");
        }}
        aria-label={edit ? "Done editing emojis" : "Edit emoji bar"}
        title={edit ? "Done" : "Edit emojis (remove or add)"}
        className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
          edit
            ? "bg-accent text-white"
            : "text-muted/60 hover:text-accent hover:bg-card2"
        }`}
      >
        {edit ? (
          <IconCheck className="w-3.5 h-3.5" />
        ) : (
          <IconEdit className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}
