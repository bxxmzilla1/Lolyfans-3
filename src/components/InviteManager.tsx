"use client";

import { useEffect, useState } from "react";
import type { Invite } from "@/lib/invites";
import CountryPicker, { countryFlag, countryName } from "./CountryPicker";
import ConfirmDialog from "./ConfirmDialog";
import Portal from "./Portal";
import { IconEdit, IconRefresh } from "./Icons";

type InviteWithStats = Invite & {
  stats: { joins: number; clicks: number; countries: Record<string, number> };
};

export default function InviteManager() {
  const [invites, setInvites] = useState<InviteWithStats[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [countries, setCountries] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Invite | null>(null);
  const [renaming, setRenaming] = useState<InviteWithStats | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const res = await fetch("/api/invites");
    if (res.ok) {
      const { invites } = await res.json();
      setInvites(invites);
    }
  }

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    setCreating(true);
    const res = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, allowedCountries: countries }),
    });
    setCreating(false);
    if (res.ok) {
      setLabel("");
      setCountries([]);
      setShowForm(false);
      load();
    }
  }

  async function toggleActive(invite: Invite) {
    await fetch("/api/invites", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: invite.id, active: !invite.active }),
    });
    load();
  }

  async function remove(invite: Invite) {
    setDeleting(null);
    await fetch("/api/invites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: invite.id }),
    });
    load();
  }

  function copy(invite: Invite) {
    const url = `${window.location.origin}/i/${invite.code}`;
    navigator.clipboard.writeText(url);
    setCopied(invite.id);
    setTimeout(() => setCopied(null), 1500);
  }

  async function saveRename() {
    if (!renaming) return;
    const id = renaming.id;
    const newLabel = renameValue.trim();
    setRenaming(null);
    await fetch("/api/invites", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, label: newLabel }),
    });
    load();
  }

  return (
    <div className="space-y-4">
      {!showForm ? (
        <div className="flex gap-2">
          <button
            onClick={() => setShowForm(true)}
            className="flex-1 bg-accent text-white font-semibold rounded-xl py-3 active:opacity-80 transition-opacity"
          >
            + New invite link
          </button>
          <button
            onClick={refresh}
            disabled={refreshing}
            title="Refresh stats"
            className="flex items-center gap-2 px-4 bg-card2 border border-line rounded-xl font-semibold text-sm text-muted hover:text-fg transition-colors disabled:opacity-50"
          >
            <IconRefresh className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      ) : (
        <div className="bg-card border border-line rounded-2xl p-4 space-y-4 fade-up">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. Twitter bio)"
            className="w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent transition-colors"
          />

          <div>
            <p className="text-sm font-semibold mb-2">
              Countries allowed to chat with this link
            </p>
            <CountryPicker selected={countries} onChange={setCountries} />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="flex-1 bg-card2 border border-line rounded-xl py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={create}
              disabled={creating}
              className="flex-1 bg-accent text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
            >
              {creating ? "Creating…" : "Create link"}
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-3">
        {invites.map((invite) => (
          <li
            key={invite.id}
            className={`bg-card border border-line rounded-2xl p-4 ${
              invite.active ? "" : "opacity-50"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-[15px] truncate">
                {invite.label || "Invite link"}
              </p>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-muted">
                  {invite.stats.clicks} click{invite.stats.clicks === 1 ? "" : "s"} ·{" "}
                  {invite.stats.joins} subscriber{invite.stats.joins === 1 ? "" : "s"}
                </span>
                <button
                  onClick={() => {
                    setRenaming(invite);
                    setRenameValue(invite.label ?? "");
                  }}
                  aria-label="Rename link"
                  title="Rename link"
                  className="w-6 h-6 rounded-lg bg-card2 border border-line text-muted hover:text-fg flex items-center justify-center"
                >
                  <IconEdit className="w-3 h-3" />
                </button>
              </div>
            </div>
            <p className="text-muted text-xs mt-0.5 break-all">/i/{invite.code}</p>
            {invite.allowed_countries && invite.allowed_countries.length > 0 ? (
              <p
                className="text-xs mt-1.5"
                title={invite.allowed_countries.map((c) => countryName(c)).join(", ")}
              >
                {invite.allowed_countries.map((c) => countryFlag(c)).join(" ")}{" "}
                <span className="text-muted">only</span>
              </p>
            ) : (
              <p className="text-xs mt-1.5 text-muted">🌍 Everyone</p>
            )}
            {invite.stats.joins > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {Object.entries(invite.stats.countries)
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, count]) => (
                    <span
                      key={code}
                      className="inline-flex items-center gap-1.5 rounded-full bg-card2 border border-line px-2.5 py-0.5 text-[11px]"
                    >
                      {code === "??" ? "🌐" : countryFlag(code)}
                      <span>{code === "??" ? "Unknown" : countryName(code)}</span>
                      <span className="text-muted">{count}</span>
                    </span>
                  ))}
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => copy(invite)}
                className="flex-1 bg-accent text-white rounded-lg py-2 text-xs font-semibold"
              >
                {copied === invite.id ? "Copied!" : "Copy link"}
              </button>
              <button
                onClick={() => toggleActive(invite)}
                className="flex-1 bg-card2 border border-line rounded-lg py-2 text-xs font-semibold"
              >
                {invite.active ? "Disable" : "Enable"}
              </button>
              <button
                onClick={() => setDeleting(invite)}
                className="px-3 bg-card2 border border-line rounded-lg py-2 text-xs font-semibold text-red-400"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      {deleting && (
        <ConfirmDialog
          title="Delete invite link"
          message="Delete this invite link? Existing chats stay."
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}

      {renaming && (
        <Portal>
        <div
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
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
                <p className="font-bold">Rename link</p>
                <p className="text-muted text-xs truncate">/i/{renaming.code}</p>
              </div>
            </div>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveRename()}
              placeholder="Link name (e.g. Twitter bio)"
              className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
            />
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
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}
