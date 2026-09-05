"use client";

import { useEffect, useState } from "react";
import { PROFILE_DESTINATION, type Invite } from "@/lib/invites";
import { IconCheck, IconHome, IconLink } from "./Icons";

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
 * Settings → Main Page Redirect: pick the invite link that visitors of the
 * bare domain are forwarded to (or turn it off to show the public feed).
 */
export default function HomeRedirectManager() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [saving, setSaving] = useState<string | "off" | null>(null);
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
        setCurrent(cfg.inviteId ?? null);
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

  async function choose(inviteId: string | null) {
    if (saving) return;
    const prev = current;
    setSaving(inviteId ?? "off");
    setError("");
    setCurrent(inviteId); // optimistic
    const res = await fetch("/api/site/home-redirect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setSaving(null);
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

  const active = invites.find((i) => i.id === current) ?? null;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-2xl border border-line bg-card p-4 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <IconHome className="w-4 h-4 text-accent" /> Main page redirect
        </p>
        <p className="text-xs text-muted">
          Send everyone who opens <span className="font-mono">{host()}</span>{" "}
          straight to one of your invite links — no home feed, no extra tap.
          Signed-in fans and your own creator login are never redirected, and
          every hit still counts as a click on that link.
        </p>
        <p className="text-xs">
          {active ? (
            <>
              <span className="text-muted">Currently: </span>
              <span className="font-mono">{host()}</span>
              <span className="text-muted"> → </span>
              <span className="font-mono">
                {host()}/{active.code}
              </span>
              <span className="text-muted"> → </span>
              {destinationLabel(active.redirect_url)}
            </>
          ) : (
            <span className="text-muted">
              Currently off — visitors see the public home feed.
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
              onClick={() => choose(null)}
              disabled={!!saving || needsMigration}
              className={`w-full text-left rounded-2xl border p-4 flex items-center gap-3 transition-colors disabled:opacity-60 ${
                current === null
                  ? "border-accent ring-1 ring-accent bg-card"
                  : "border-line bg-card hover:bg-card2/60"
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  current === null ? "bg-accent border-accent" : "border-line"
                }`}
              >
                {current === null && <IconCheck className="w-3 h-3 text-white" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Off</span>
                <span className="block text-xs text-muted">
                  Show the public home feed on {host()}
                </span>
              </span>
            </button>
          </li>

          {invites.map((invite) => {
            const selected = current === invite.id;
            return (
              <li key={invite.id}>
                <button
                  onClick={() => choose(invite.id)}
                  disabled={!!saving || needsMigration}
                  className={`w-full text-left rounded-2xl border p-4 flex items-center gap-3 transition-colors disabled:opacity-60 ${
                    selected
                      ? "border-accent ring-1 ring-accent bg-card"
                      : "border-line bg-card hover:bg-card2/60"
                  } ${invite.active ? "" : "opacity-50"}`}
                >
                  <span
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      selected ? "bg-accent border-accent" : "border-line"
                    }`}
                  >
                    {selected && <IconCheck className="w-3 h-3 text-white" />}
                  </span>
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
            <li className="text-sm text-muted text-center py-6">
              No invite links yet — create one in the Invite links tab first.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
