"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconChart, IconKey, IconRefresh } from "./Icons";

type Row = {
  label: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  revenue: number;
};

type Range = "today" | "7d" | "30d" | "month";
type GroupBy = "date" | "placement" | "country";

const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "month", label: "This month" },
];

const GROUPS: { id: GroupBy; label: string }[] = [
  { id: "date", label: "By date" },
  { id: "placement", label: "By placement" },
  { id: "country", label: "By country" },
];

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeDates(range: Range): { start: string; finish: string } {
  const now = new Date();
  const finish = isoDay(now);
  if (range === "today") return { start: finish, finish };
  if (range === "month") {
    return {
      start: isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
      finish,
    };
  }
  const days = range === "7d" ? 6 : 29;
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - days);
  return { start: isoDay(start), finish };
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (n: number) => n.toLocaleString("en-US");

/**
 * Creator dashboard: Adsterra earnings (Publishers API v3) — replaces the old
 * chat inbox. Needs the creator's Adsterra API token once; stats are proxied
 * through /api/adsterra so the token stays server-side.
 */
export default function AdsterraDashboard() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [range, setRange] = useState<Range>("7d");
  const [groupBy, setGroupBy] = useState<GroupBy>("date");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/adsterra/token")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setConfigured(!!data?.configured))
      .catch(() => setConfigured(false));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { start, finish } = rangeDates(range);
    const res = await fetch(
      `/api/adsterra/stats?start_date=${start}&finish_date=${finish}&group_by=${groupBy}`
    ).catch(() => null);
    const data = await res?.json().catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      setError(data?.error || "Could not load stats");
      setRows([]);
      return;
    }
    const sorted = [...(data.rows as Row[])].sort((a, b) =>
      groupBy === "date"
        ? a.label.localeCompare(b.label)
        : b.revenue - a.revenue
    );
    setRows(sorted);
  }, [range, groupBy]);

  useEffect(() => {
    if (configured) void load();
  }, [configured, load]);

  const totals = useMemo(() => {
    const t = { impressions: 0, clicks: 0, revenue: 0 };
    for (const r of rows ?? []) {
      t.impressions += r.impressions;
      t.clicks += r.clicks;
      t.revenue += r.revenue;
    }
    return {
      ...t,
      ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0,
      cpm: t.impressions > 0 ? (t.revenue / t.impressions) * 1000 : 0,
    };
  }, [rows]);

  const maxRevenue = useMemo(
    () => Math.max(0, ...(rows ?? []).map((r) => r.revenue)),
    [rows]
  );

  if (configured === null) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        Loading dashboard…
      </div>
    );
  }

  if (!configured) {
    return <TokenSetup onDone={() => setConfigured(true)} />;
  }

  return (
    <div className="h-full overflow-y-auto overscroll-contain touch-pan-y">
      <div className="max-w-3xl mx-auto p-4 lg:p-8 space-y-4 pb-24 lg:pb-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl ig-gradient glow-accent flex items-center justify-center shrink-0">
              <IconChart className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-lg leading-tight">Earnings</h1>
              <p className="text-muted text-xs">Adsterra · updates hourly</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => void load()}
              disabled={loading}
              title="Refresh"
              aria-label="Refresh"
              className="w-9 h-9 rounded-xl bg-card2 border border-line text-muted hover:text-fg flex items-center justify-center disabled:opacity-50"
            >
              <IconRefresh className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <ChangeTokenButton onCleared={() => setConfigured(false)} />
          </div>
        </div>

        {/* Date range */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none [&>button]:shrink-0">
          {RANGES.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setRange(id)}
              className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
                range === id
                  ? "bg-accent text-white"
                  : "bg-card2 border border-line text-muted hover:text-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <StatCard label="Revenue" value={money(totals.revenue)} accent />
          <StatCard label="Impressions" value={compact(totals.impressions)} />
          <StatCard label="Clicks" value={compact(totals.clicks)} />
          <StatCard label="CTR" value={`${totals.ctr.toFixed(2)}%`} />
          <StatCard label="CPM" value={money(totals.cpm)} />
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            {error}
          </p>
        )}

        {/* Revenue bars — only meaningful for the by-date view */}
        {groupBy === "date" && (rows?.length ?? 0) > 1 && maxRevenue > 0 && (
          <div className="bg-card border border-line rounded-2xl p-4">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">
              Revenue per day
            </p>
            <div className="flex items-end gap-1 h-28">
              {rows!.map((r) => (
                <div
                  key={r.label}
                  className="flex-1 min-w-0 flex flex-col items-center gap-1"
                  title={`${r.label}: ${money(r.revenue)}`}
                >
                  <div
                    className="w-full rounded-t bg-accent/80"
                    style={{
                      height: `${Math.max(3, (r.revenue / maxRevenue) * 100)}%`,
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted mt-1.5">
              <span>{rows![0].label.slice(5)}</span>
              <span>{rows![rows!.length - 1].label.slice(5)}</span>
            </div>
          </div>
        )}

        {/* Grouping tabs + table */}
        <div className="bg-card border border-line rounded-2xl overflow-hidden">
          <div className="flex gap-1.5 p-3 border-b border-line">
            {GROUPS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setGroupBy(id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  groupBy === id
                    ? "bg-accent text-white"
                    : "bg-card2 border border-line text-muted hover:text-fg"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading && rows === null ? (
            <p className="text-muted text-sm text-center py-10">Loading stats…</p>
          ) : (rows?.length ?? 0) === 0 ? (
            <p className="text-muted text-sm text-center py-10">
              No data for this period yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted border-b border-line">
                    <th className="px-4 py-2.5 font-semibold">
                      {groupBy === "date"
                        ? "Date"
                        : groupBy === "placement"
                          ? "Placement"
                          : "Country"}
                    </th>
                    <th className="px-3 py-2.5 font-semibold text-right">Impr.</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Clicks</th>
                    <th className="px-3 py-2.5 font-semibold text-right">CTR</th>
                    <th className="px-3 py-2.5 font-semibold text-right">CPM</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows!.map((r, i) => (
                    <tr key={`${r.label}-${i}`}>
                      <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                        {r.label || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted">
                        {compact(r.impressions)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted">
                        {compact(r.clicks)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted">
                        {r.ctr.toFixed(2)}%
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted">
                        {money(r.cpm)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">
                        {money(r.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3.5 ${
        accent
          ? "border-accent/40 bg-accent/10"
          : "border-line bg-card"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className={`text-lg font-bold mt-0.5 truncate ${accent ? "text-accent" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function ChangeTokenButton({ onCleared }: { onCleared: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        if (busy || !confirm("Disconnect Adsterra and enter a new API token?")) return;
        setBusy(true);
        await fetch("/api/adsterra/token", { method: "DELETE" }).catch(() => {});
        setBusy(false);
        onCleared();
      }}
      disabled={busy}
      title="Change API token"
      aria-label="Change API token"
      className="w-9 h-9 rounded-xl bg-card2 border border-line text-muted hover:text-fg flex items-center justify-center disabled:opacity-50"
    >
      <IconKey className="w-4 h-4" />
    </button>
  );
}

/** First-run screen: paste the Adsterra API token (validated before saving). */
function TokenSetup({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (busy || !token.trim()) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/adsterra/token", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(data?.error || "Could not save the token");
      return;
    }
    onDone();
  }

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-5 text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl ig-gradient glow-accent flex items-center justify-center">
          <IconChart className="w-8 h-8 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Adsterra dashboard</h1>
          <p className="text-muted text-sm mt-1">
            See your ad revenue, impressions, clicks, CTR and CPM right here.
            Connect your Adsterra account with an API token.
          </p>
        </div>
        <ol className="text-left text-sm text-muted space-y-1.5 bg-card border border-line rounded-2xl p-4 list-decimal list-inside">
          <li>
            Log in at <span className="font-semibold text-fg">adsterra.com</span> as a publisher
          </li>
          <li>
            Open <span className="font-semibold text-fg">Settings → API</span>
          </li>
          <li>
            Hit <span className="font-semibold text-fg">Generate new token</span> and copy it
          </li>
        </ol>
        <div className="space-y-2">
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="Paste your API token…"
            className="w-full bg-card2 border border-line rounded-xl px-4 py-3 text-sm placeholder:text-muted focus:border-accent outline-none font-mono"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            onClick={() => void save()}
            disabled={busy || !token.trim()}
            className="w-full bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-40"
          >
            {busy ? "Checking token…" : "Connect Adsterra"}
          </button>
        </div>
      </div>
    </div>
  );
}
