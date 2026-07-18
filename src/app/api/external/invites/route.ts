import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ownerFromApiKey } from "@/lib/apiKey";

// Allow external clients (e.g. the Fanciaga desktop app) to call this.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * External read API for connected apps (Fanciaga tracking). Returns every
 * invite link the owner has, with its "subscribers" (unique-IP joins) and
 * "clicks" (unique-IP page visits) totals, a per-country breakdown, and a
 * daily subscribers/clicks series within an optional window — mirroring the
 * shape an OnlyFans campaign exposes so it can slot into the same analytics.
 *
 * Auth is the owner's API key (Authorization: Bearer, or x-api-key).
 * Query params (optional): date_start, date_end (ISO). Default: last 30 days.
 */
export async function GET(req: NextRequest) {
  const ownerId = await ownerFromApiKey(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS });
  }

  const url = new URL(req.url);
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  const startParam = url.searchParams.get("date_start");
  const endParam = url.searchParams.get("date_end");
  const start = startParam ? new Date(startParam) : defaultStart;
  const end = endParam ? new Date(endParam) : now;
  const startMs = Number.isFinite(start.getTime()) ? start.getTime() : defaultStart.getTime();
  const endMs = Number.isFinite(end.getTime()) ? end.getTime() : now.getTime();

  const db = supabaseAdmin();
  const [invitesRes, chatsRes, visitsRes] = await Promise.all([
    db
      .from("invites")
      .select("id, code, label, active, created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false }),
    db
      .from("chats")
      .select("id, invite_id, guest_country, guest_ip, created_at")
      .eq("owner_id", ownerId)
      .not("invite_id", "is", null),
    db
      .from("invite_visits")
      .select("invite_id, created_at, invites!inner(owner_id)")
      .eq("invites.owner_id", ownerId),
  ]);

  if (invitesRes.error) {
    return NextResponse.json({ error: invitesRes.error.message }, { status: 500, headers: CORS });
  }

  type Daily = { subscribers: number; clicks: number };
  type Agg = {
    subscribers: number;
    clicks: number;
    countries: Record<string, number>;
    daily: Record<string, Daily>;
  };
  const blank = (): Agg => ({ subscribers: 0, clicks: 0, countries: {}, daily: {} });
  const stats: Record<string, Agg> = {};
  const dayBucket = (a: Agg, key: string): Daily => (a.daily[key] ??= { subscribers: 0, clicks: 0 });

  // Subscribers = chats that joined via the link, deduplicated by IP (the same
  // device rejoining doesn't count twice), keyed to the first join's day.
  const seenIps: Record<string, Set<string>> = {};
  for (const chat of chatsRes.data ?? []) {
    const inviteId = chat.invite_id as string;
    stats[inviteId] ??= blank();
    seenIps[inviteId] ??= new Set();
    const key = chat.guest_ip || `chat:${chat.id}`;
    if (seenIps[inviteId].has(key)) continue;
    seenIps[inviteId].add(key);
    stats[inviteId].subscribers += 1;
    const country = (chat.guest_country || "??").toUpperCase();
    stats[inviteId].countries[country] = (stats[inviteId].countries[country] ?? 0) + 1;
    const ts = new Date(chat.created_at as string).getTime();
    if (ts >= startMs && ts <= endMs) {
      dayBucket(stats[inviteId], ymd(new Date(ts))).subscribers += 1;
    }
  }

  // Clicks = unique-IP page visits (rows are already unique per invite+ip).
  for (const visit of visitsRes.data ?? []) {
    const inviteId = visit.invite_id as string;
    stats[inviteId] ??= blank();
    stats[inviteId].clicks += 1;
    const ts = new Date(visit.created_at as string).getTime();
    if (ts >= startMs && ts <= endMs) {
      dayBucket(stats[inviteId], ymd(new Date(ts))).clicks += 1;
    }
  }

  // Continuous daily axis (fill empty days with zero) across the window.
  const dayKeys: string[] = [];
  for (let t = startMs; t <= endMs; t += 24 * 60 * 60 * 1000) {
    dayKeys.push(ymd(new Date(t)));
  }

  const invites = (invitesRes.data ?? []).map((invite) => {
    const s = stats[invite.id] ?? blank();
    return {
      id: invite.id,
      code: invite.code,
      label: invite.label,
      active: invite.active,
      subscribers: s.subscribers,
      clicks: s.clicks,
      countries: s.countries,
      daily: dayKeys.map((date) => ({
        date,
        subscribers: s.daily[date]?.subscribers ?? 0,
        clicks: s.daily[date]?.clicks ?? 0,
      })),
    };
  });

  return NextResponse.json(
    { invites, dateStart: ymd(new Date(startMs)), dateEnd: ymd(new Date(endMs)) },
    { headers: CORS }
  );
}
