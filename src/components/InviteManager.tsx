"use client";

import { useEffect, useState } from "react";
import { PROFILE_DESTINATION, type Invite } from "@/lib/invites";
import CountryPicker, { countryFlag, countryName } from "./CountryPicker";
import ConfirmDialog from "./ConfirmDialog";
import Portal from "./Portal";
import { IconCheck, IconEdit, IconMapPin, IconRefresh } from "./Icons";

type InviteWithStats = Invite & {
  stats: { joins: number; clicks: number; countries: Record<string, number> };
};

// Module-level cache: reopening the tab paints the last known list instantly
// while the fresh data loads in the background.
let invitesCache: InviteWithStats[] | null = null;

/** Short display form of a redirect URL (hostname, or raw text if unparsable). */
function redirectHost(url: string): string {
  if (url === PROFILE_DESTINATION) return "My profile page";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Destination picker: send visitors to a custom URL or the profile page. */
function DestinationToggle({
  toProfile,
  onChange,
}: {
  toProfile: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`rounded-xl py-2.5 text-sm font-semibold border transition-colors ${
          !toProfile
            ? "bg-accent text-white border-accent"
            : "bg-card2 border-line text-muted hover:text-fg"
        }`}
      >
        Custom link
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`rounded-xl py-2.5 text-sm font-semibold border transition-colors ${
          toProfile
            ? "bg-accent text-white border-accent"
            : "bg-card2 border-line text-muted hover:text-fg"
        }`}
      >
        My profile page
      </button>
    </div>
  );
}

type Visit = {
  ip: string;
  country: string | null;
  city: string | null;
  region: string | null;
  org: string | null;
  created_at: string;
  last_seen_at: string | null;
};

function visitTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Geo-located visitors of one link (ipinfo) in a popup. */
function VisitorsModal({
  invite,
  onClose,
}: {
  invite: InviteWithStats;
  onClose: () => void;
}) {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/invites/visits?id=${encodeURIComponent(invite.id)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) setVisits(data.visits ?? []);
        else setError(data.error || "Could not load visitors");
      })
      .catch(() => {
        if (!cancelled) setError("Could not load visitors");
      });
    return () => {
      cancelled = true;
    };
  }, [invite.id]);

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md bg-card border border-line rounded-2xl fade-up max-h-[85dvh] flex flex-col overflow-hidden"
        >
          <header className="px-4 py-3 border-b border-line flex items-center justify-between gap-2 shrink-0">
            <div className="min-w-0 flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl ig-gradient glow-accent flex items-center justify-center shrink-0">
                <IconMapPin className="w-4.5 h-4.5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="font-bold truncate">
                  Visitors — {invite.label || "Invite link"}
                </p>
                <p className="text-muted text-xs truncate">
                  /i/{invite.code}
                  {visits ? ` · ${visits.length} unique IP${visits.length === 1 ? "" : "s"}` : ""}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-lg bg-card2 border border-line text-muted hover:text-fg flex items-center justify-center shrink-0"
            >
              ✕
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-3">
            {error ? (
              <p className="py-10 text-center text-sm text-red-400">{error}</p>
            ) : visits === null ? (
              <div className="space-y-2 py-2">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-14 rounded-xl bg-card2 animate-pulse"
                  />
                ))}
              </div>
            ) : visits.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">
                No visitors yet — locations show up here after the next
                clicks.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {visits.map((v) => {
                  const place = [v.city, v.region]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <li
                      key={v.ip}
                      className="rounded-xl bg-card2 border border-line px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base shrink-0">
                          {v.country ? countryFlag(v.country) : "🌐"}
                        </span>
                        <p className="text-sm font-semibold truncate flex-1">
                          {place ||
                            (v.country
                              ? countryName(v.country)
                              : "Unknown location")}
                        </p>
                        <span className="text-[11px] text-muted shrink-0">
                          {visitTime(v.last_seen_at || v.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 pl-7">
                        <p className="text-xs text-muted truncate flex-1">
                          {v.country ? `${countryName(v.country)} · ` : ""}
                          <span className="font-mono">{v.ip}</span>
                        </p>
                      </div>
                      {v.org && (
                        <p className="text-[11px] text-muted/80 truncate mt-0.5 pl-7">
                          {v.org}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

export default function InviteManager() {
  const [invites, setInvites] = useState<InviteWithStats[]>(invitesCache ?? []);
  const [loading, setLoading] = useState(invitesCache === null);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [countries, setCountries] = useState<string[]>([]);
  const [redirectUrl, setRedirectUrl] = useState("");
  // Destination: false = custom URL, true = the creator's own profile page.
  const [toProfile, setToProfile] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Invite | null>(null);
  const [renaming, setRenaming] = useState<InviteWithStats | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [editRedirectUrl, setEditRedirectUrl] = useState("");
  const [editToProfile, setEditToProfile] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Multi-select for bulk country changes
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCountries, setBulkCountries] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  // Geo-located visitors popup
  const [visitorsFor, setVisitorsFor] = useState<InviteWithStats | null>(null);

  async function load() {
    const res = await fetch("/api/invites").catch(() => null);
    if (res?.ok) {
      const { invites } = await res.json();
      invitesCache = invites;
      setInvites(invites);
    }
    setLoading(false);
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
    if (!toProfile && !redirectUrl.trim()) return;
    setCreating(true);
    const res = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label,
        allowedCountries: countries,
        redirectUrl: toProfile ? PROFILE_DESTINATION : redirectUrl,
      }),
    });
    setCreating(false);
    if (res.ok) {
      setLabel("");
      setCountries([]);
      setRedirectUrl("");
      setToProfile(false);
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

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Apply the chosen allowed countries to these links (selected or ALL). */
  async function applyCountries(ids: string[]) {
    if (applying || ids.length === 0) return;
    setApplying(true);
    await fetch("/api/invites", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, allowedCountries: bulkCountries }),
    });
    setApplying(false);
    setSelectMode(false);
    setSelected(new Set());
    setBulkCountries([]);
    load();
  }

  async function resetStats() {
    setConfirmReset(false);
    if (resetting) return;
    setResetting(true);
    await fetch("/api/invites/reset", { method: "POST" });
    await load();
    setResetting(false);
  }

  async function saveRename() {
    if (!renaming) return;
    const newRedirectUrl = editToProfile
      ? PROFILE_DESTINATION
      : editRedirectUrl.trim();
    if (!newRedirectUrl) return; // the redirect link is mandatory
    const id = renaming.id;
    const newLabel = renameValue.trim();
    setRenaming(null);
    await fetch("/api/invites", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        label: newLabel,
        redirectUrl: newRedirectUrl,
      }),
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
          {invites.length > 0 && (
            <button
              onClick={() => setConfirmReset(true)}
              disabled={resetting}
              title="Reset clicks and subscribers on all links"
              className="px-4 bg-card2 border border-line rounded-xl font-semibold text-sm text-red-400 hover:text-red-500 transition-colors disabled:opacity-50"
            >
              {resetting ? "Resetting…" : "Reset stats"}
            </button>
          )}
          {invites.length > 0 && (
            <button
              onClick={() => {
                setSelectMode((v) => !v);
                setSelected(new Set());
                setBulkCountries([]);
              }}
              className={`px-4 rounded-xl font-semibold text-sm transition-colors ${
                selectMode
                  ? "bg-accent text-white"
                  : "bg-card2 border border-line text-muted hover:text-fg"
              }`}
            >
              {selectMode ? "Cancel" : "Select"}
            </button>
          )}
        </div>
      ) : (
        <div className="bg-card border border-line rounded-2xl p-4 space-y-4 fade-up">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. Twitter bio)"
            className="w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent transition-colors"
          />

          <div className="space-y-1.5">
            <p className="text-sm font-semibold">
              Destination <span className="text-red-400">*</span>
            </p>
            <p className="text-xs text-muted">
              Where allowed visitors are sent when they open the link.
            </p>
            <DestinationToggle toProfile={toProfile} onChange={setToProfile} />
            {toProfile ? (
              <p className="text-xs text-muted">
                Visitors land on your public profile page with your posts.
              </p>
            ) : (
              <input
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                type="url"
                required
                placeholder="https://t.me/…"
                className="w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent transition-colors"
              />
            )}
          </div>

          <div>
            <p className="text-sm font-semibold mb-2">
              Countries allowed to use this link
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
              disabled={creating || (!toProfile && !redirectUrl.trim())}
              className="flex-1 bg-accent text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
            >
              {creating ? "Creating…" : "Create link"}
            </button>
          </div>
        </div>
      )}

      {selectMode && (
        <div className="bg-card border border-line rounded-2xl p-4 space-y-3 fade-up">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-accent">
              {selected.size} link{selected.size === 1 ? "" : "s"} selected
            </p>
            <button
              onClick={() =>
                setSelected(
                  selected.size === invites.length
                    ? new Set()
                    : new Set(invites.map((i) => i.id))
                )
              }
              className="text-xs font-semibold text-muted hover:text-fg"
            >
              {selected.size === invites.length ? "Clear all" : "Select all"}
            </button>
          </div>
          <p className="text-sm font-semibold">
            Countries allowed to use the links{" "}
            <span className="text-muted font-normal text-xs">
              (empty = everyone)
            </span>
          </p>
          <CountryPicker selected={bulkCountries} onChange={setBulkCountries} />
          <div className="flex gap-2">
            <button
              onClick={() => applyCountries([...selected])}
              disabled={applying || selected.size === 0}
              className="flex-1 bg-card2 border border-line font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
            >
              {applying
                ? "Applying…"
                : `Apply to selected (${selected.size})`}
            </button>
            <button
              onClick={() => applyCountries(invites.map((i) => i.id))}
              disabled={applying || invites.length === 0}
              className="flex-1 bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
            >
              {applying
                ? "Applying…"
                : `Apply to ALL ${invites.length} link${invites.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {loading && invites.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="bg-card border border-line rounded-2xl p-4 space-y-3 animate-pulse"
            >
              <div className="h-4 w-2/5 rounded bg-card2" />
              <div className="h-3 w-3/5 rounded bg-card2" />
              <div className="h-9 w-full rounded-xl bg-card2" />
            </div>
          ))}
        </div>
      )}

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
        {invites.map((invite) => (
          <li
            key={invite.id}
            onClick={() => selectMode && toggleSelected(invite.id)}
            className={`bg-card border rounded-2xl p-4 transition-colors ${
              selectMode && selected.has(invite.id)
                ? "border-accent ring-1 ring-accent cursor-pointer"
                : selectMode
                ? "border-line cursor-pointer hover:bg-card2/60"
                : "border-line"
            } ${invite.active ? "" : "opacity-50"}`}
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
                {selectMode ? (
                  <span
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      selected.has(invite.id)
                        ? "bg-accent border-accent"
                        : "border-line"
                    }`}
                  >
                    {selected.has(invite.id) && (
                      <IconCheck className="w-3 h-3 text-white" />
                    )}
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      setRenaming(invite);
                      setRenameValue(invite.label ?? "");
                      const isProfile =
                        invite.redirect_url === PROFILE_DESTINATION;
                      setEditToProfile(isProfile);
                      setEditRedirectUrl(isProfile ? "" : invite.redirect_url ?? "");
                    }}
                    aria-label="Edit link"
                    title="Edit link"
                    className="w-6 h-6 rounded-lg bg-card2 border border-line text-muted hover:text-fg flex items-center justify-center"
                  >
                    <IconEdit className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            <p className="text-muted text-xs mt-0.5 break-all">/i/{invite.code}</p>
            {invite.redirect_url ? (
              <p
                className="text-xs mt-1 truncate"
                title={invite.redirect_url}
              >
                <span className="text-muted">→ </span>
                {redirectHost(invite.redirect_url)}
              </p>
            ) : (
              <p className="text-xs mt-1 text-red-400 font-semibold">
                No redirect link — edit to add one
              </p>
            )}
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
            {!selectMode && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => copy(invite)}
                  className="flex-1 bg-accent text-white rounded-lg py-2 text-xs font-semibold"
                >
                  {copied === invite.id ? "Copied!" : "Copy link"}
                </button>
                <button
                  onClick={() => setVisitorsFor(invite)}
                  title="Visitor locations"
                  aria-label="Visitor locations"
                  className="px-3 bg-card2 border border-line rounded-lg py-2 text-xs font-semibold flex items-center gap-1.5 text-muted hover:text-fg transition-colors"
                >
                  <IconMapPin className="w-3.5 h-3.5" />
                  Visitors
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
            )}
          </li>
        ))}
      </ul>

      {confirmReset && (
        <ConfirmDialog
          title="Reset link stats"
          message="Set clicks and subscribers back to 0 on every invite link? The chats themselves stay — only the tracking counts are wiped. This can't be undone."
          onConfirm={resetStats}
          onCancel={() => setConfirmReset(false)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete invite link"
          message="Delete this invite link? Existing chats stay."
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}

      {visitorsFor && (
        <VisitorsModal
          invite={visitorsFor}
          onClose={() => setVisitorsFor(null)}
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
            className="w-full max-w-sm bg-card border border-line rounded-2xl p-4 space-y-3 fade-up max-h-[85dvh] overflow-y-auto"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl ig-gradient glow-accent flex items-center justify-center shrink-0">
                <IconEdit className="w-4.5 h-4.5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="font-bold">Edit link</p>
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
            <div className="space-y-1.5 border-t border-line pt-3">
              <p className="text-sm font-semibold">
                Destination <span className="text-red-400">*</span>
              </p>
              <p className="text-xs text-muted">
                Where allowed visitors are sent when they open the link.
              </p>
              <DestinationToggle
                toProfile={editToProfile}
                onChange={setEditToProfile}
              />
              {editToProfile ? (
                <p className="text-xs text-muted">
                  Visitors land on your public profile page with your posts.
                </p>
              ) : (
                <input
                  value={editRedirectUrl}
                  onChange={(e) => setEditRedirectUrl(e.target.value)}
                  type="url"
                  required
                  placeholder="https://t.me/…"
                  className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none"
                />
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setRenaming(null)}
                className="flex-1 bg-card2 border border-line rounded-xl py-2.5 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={saveRename}
                disabled={!editToProfile && !editRedirectUrl.trim()}
                className="flex-1 bg-accent text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
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
