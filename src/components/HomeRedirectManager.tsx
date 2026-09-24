"use client";

import { useEffect, useState } from "react";
import { PROFILE_DESTINATION, type Invite } from "@/lib/invites";
import type { CreatorCardData } from "@/lib/creatorDirectory";
import { mediaUrl } from "@/lib/utils";
import { IconCheck, IconHome, IconLink, IconUser, IconVerified } from "./Icons";

/** What the bare domain currently does. */
type Choice =
  | { kind: "off" }
  | { kind: "creator"; id: string }
  | { kind: "invite"; id: string };

function sameChoice(a: Choice, b: Choice) {
  return a.kind === b.kind && ("id" in a ? a.id : null) === ("id" in b ? b.id : null);
}

const MIGRATION_SQL = `create table if not exists site_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table site_settings enable row level security;`;

function host(): string {
  if (typeof window === "undefined") return "lolyfans.com";
  return window.location.host.replace(/^www\./, "");
}

function destinationLabel(url: string | null | undefined): string {
  if (!url) return "no destination";
  if (url === PROFILE_DESTINATION) return "your profile page";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Settings → Main Page: what visitors of the bare domain see — a specific
 * creator's chat, one of your invite links, or the creator cards (off).
 */
export default function HomeRedirectManager() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [creators, setCreators] = useState<CreatorCardData[]>([]);
  const [current, setCurrent] = useState<Choice>({ kind: "off" });
  const [loading, setLoading] = useState(true);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/invites").then((r) => (r.ok ? r.json() : { invites: [] })),
      fetch("/api/site/home-redirect").then((r) => r.json()),
    ])
      .then(([inv, cfg]) => {
        if (cancelled) return;
        setInvites((inv.invites ?? []) as Invite[]);
        setCreators((cfg.creators ?? []) as CreatorCardData[]);
        setCurrent(
          cfg.creatorId
            ? { kind: "creator", id: cfg.creatorId }
            : cfg.inviteId
              ? { kind: "invite", id: cfg.inviteId }
              : { kind: "off" }
        );
        setNeedsMigration(!!cfg.needsMigration);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load — try again");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function choose(next: Choice) {
    if (saving) return;
    const prev = current;
    setSaving(true);
    setError("");
    setCurrent(next); // optimistic
    const res = await fetch("/api/site/home-redirect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creatorId: next.kind === "creator" ? next.id : null,
        inviteId: next.kind === "invite" ? next.id : null,
      }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setSaving(false);
    if (!res?.ok) {
      setCurrent(prev);
      if (data?.needsMigration) setNeedsMigration(true);
      else setError(data?.error || "Could not save — try again");
      return;
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  function copySql() {
    navigator.clipboard.writeText(MIGRATION_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const activeInvite =
    current.kind === "invite" ? invites.find((i) => i.id === current.id) ?? null : null;
  const activeCreator =
    current.kind === "creator"
      ? creators.find((c) => c.ownerId === current.id) ?? null
      : null;

  const optionClass = (selected: boolean, dim = false) =>
    `w-full text-left rounded-2xl border p-4 flex items-center gap-3 transition-colors disabled:opacity-60 ${
      selected ? "border-accent ring-1 ring-accent bg-card" : "border-line bg-card hover:bg-card2/60"
    } ${dim ? "opacity-50" : ""}`;
  const radio = (selected: boolean) => (
    <span
      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
        selected ? "bg-accent border-accent" : "border-line"
      }`}
    >
      {selected && <IconCheck className="w-3 h-3 text-white" />}
    </span>
  );

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-2xl border border-line bg-card p-4 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <IconHome className="w-4 h-4 text-accent" /> Main page
        </p>
        <p className="text-xs text-muted">
          Choose what everyone who opens <span className="font-mono">{host()}</span>{" "}
          sees: one creator&apos;s chat (visitors can start chatting right away
          and sign up when they write), one of your invite links, or the
          creator cards. Signed-in fans and creator logins are never redirected.
        </p>
        <p className="text-xs">
          {activeCreator ? (
            <>
              <span className="text-muted">Currently: </span>
              <span className="font-mono">{host()}</span>
              <span className="text-muted"> → </span>
              {activeCreator.name}&apos;s chat
            </>
          ) : current.kind === "creator" ? (
            <>
              <span className="text-muted">Currently: </span>
              <span className="font-mono">{host()}</span>
              <span className="text-muted"> → a creator&apos;s chat</span>
            </>
          ) : activeInvite ? (
            <>
              <span className="text-muted">Currently: </span>
              <span className="font-mono">{host()}</span>
              <span className="text-muted"> → </span>
              <span className="font-mono">
                {host()}/{activeInvite.code}
              </span>
              <span className="text-muted"> → </span>
              {destinationLabel(activeInvite.redirect_url)}
            </>
          ) : (
            <span className="text-muted">
              Currently off — visitors see the creator cards.
            </span>
          )}
          {savedFlash && (
            <span className="ml-2 text-accent font-semibold">Saved!</span>
          )}
        </p>
      </div>

      {needsMigration && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
          <p className="text-sm font-semibold text-amber-300">
            One-time database setup needed
          </p>
          <p className="text-xs text-muted">
            Run this in the Supabase SQL editor (Database → SQL), then reopen
            this tab. It creates the tiny table this setting is stored in.
          </p>
          <pre className="text-[11px] leading-relaxed bg-card2 border border-line rounded-xl p-3 overflow-x-auto whitespace-pre">
            {MIGRATION_SQL}
          </pre>
          <button
            onClick={copySql}
            className="px-4 py-2 rounded-xl bg-accent text-white text-xs font-semibold"
          >
            {copied ? "Copied!" : "Copy SQL"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-2xl bg-card2 animate-pulse" />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          <li>
            <button
              onClick={() => choose({ kind: "off" })}
              disabled={saving || needsMigration}
              className={optionClass(current.kind === "off")}
            >
              {radio(current.kind === "off")}
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Off</span>
                <span className="block text-xs text-muted">
                  Show the creator cards on {host()}
                </span>
              </span>
            </button>
          </li>

          <li className="pt-2">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide px-1">
              Show a creator&apos;s chat
            </p>
          </li>
          {creators.map((creator) => {
            const selected = sameChoice(current, { kind: "creator", id: creator.ownerId });
            return (
              <li key={creator.ownerId}>
                <button
                  onClick={() => choose({ kind: "creator", id: creator.ownerId })}
                  disabled={saving || needsMigration}
                  className={optionClass(selected)}
                >
                  {radio(selected)}
                  {creator.avatarPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(creator.avatarPath)}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover bg-card2 shrink-0"
                    />
                  ) : (
                    <span className="w-9 h-9 rounded-full bg-card2 flex items-center justify-center shrink-0">
                      <IconUser className="w-4 h-4 text-muted" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold truncate">
                      {creator.name}
                      <IconVerified className="inline w-4 h-4 ml-1 -mt-0.5 text-accent" />
                    </span>
                    <span className="block text-xs text-muted truncate">
                      {host()} opens this creator&apos;s chat
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {creators.length === 0 && (
            <li className="text-xs text-muted px-1">
              No creators with an active invite link yet — a creator needs one
              so visitors can sign up from their chat.
            </li>
          )}

          <li className="pt-2">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide px-1">
              Forward to one of your invite links
            </p>
          </li>
          {invites.map((invite) => {
            const selected = sameChoice(current, { kind: "invite", id: invite.id });
            return (
              <li key={invite.id}>
                <button
                  onClick={() => choose({ kind: "invite", id: invite.id })}
                  disabled={saving || needsMigration}
                  className={optionClass(selected, !invite.active)}
                >
                  {radio(selected)}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold truncate">
                      {invite.label || "Invite link"}
                      {!invite.active && (
                        <span className="ml-2 text-xs text-red-400 font-normal">
                          disabled — won&apos;t redirect
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted truncate">
                      <IconLink className="inline w-3 h-3 mr-1 -mt-0.5" />
                      {host()}/{invite.code}
                      <span className="mx-1">→</span>
                      {destinationLabel(invite.redirect_url)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}

          {invites.length === 0 && (
            <li className="text-xs text-muted px-1">
              No invite links yet — create one in the Invite links tab first.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
