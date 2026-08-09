import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { fetchAllRows } from "@/lib/fetchAllRows";

type Stats = { joins: number; clicks: number; countries: Record<string, number> };
const blank = (): Stats => ({ joins: 0, clicks: 0, countries: {} });

export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  // Stats come from ONE SQL round trip (invite_stats in schema.sql). Paging
  // every chat/visit row through the API made this tab crawl for accounts
  // with thousands of fans.
  const [invitesRes, statsRes] = await Promise.all([
    db
      .from("invites")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false }),
    db.rpc("invite_stats", { p_owner_id: ownerId }),
  ]);
  if (invitesRes.error) {
    return NextResponse.json({ error: invitesRes.error.message }, { status: 500 });
  }

  const stats: Record<string, Stats> = {};
  if (!statsRes.error && Array.isArray(statsRes.data)) {
    for (const row of statsRes.data as {
      invite_id: string;
      joins: number;
      clicks: number;
      countries: Record<string, number> | null;
    }[]) {
      stats[row.invite_id] = {
        joins: Number(row.joins) || 0,
        clicks: Number(row.clicks) || 0,
        countries: row.countries ?? {},
      };
    }
  } else {
    // Function not installed yet: the old paged reads, so the tab still works
    // (slowly) until migration-invite-stats.sql is run.
    Object.assign(stats, await legacyStats(ownerId));
  }

  return NextResponse.json({
    invites: (invitesRes.data ?? []).map((invite) => ({
      ...invite,
      stats: stats[invite.id] ?? blank(),
    })),
  });
}

/** Pre-migration fallback: pages every chat + visit row (slow but correct). */
async function legacyStats(ownerId: string): Promise<Record<string, Stats>> {
  const db = supabaseAdmin();
  const [chatsRes, visitsRes] = await Promise.all([
    // Paged reads (fetchAllRows): Supabase caps selects at 1000 rows, which
    // froze click/subscriber counts at exactly 1000 once links got popular.
    fetchAllRows((from, to) =>
      db
        .from("chats")
        .select("id, invite_id, guest_country, guest_ip")
        .eq("owner_id", ownerId)
        .not("invite_id", "is", null)
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
    // Unique-IP page visits per link ("clicks"), scoped to this owner's links
    fetchAllRows((from, to) =>
      db
        .from("invite_visits")
        .select("invite_id, invites!inner(owner_id)")
        .eq("invites.owner_id", ownerId)
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
  ]);

  // Per link: subscribers = people who created a chat (deduplicated by IP —
  // the same device rejoining doesn't count twice), plus their countries.
  const stats: Record<string, Stats> = {};
  const seenIps: Record<string, Set<string>> = {};
  for (const chat of chatsRes.data ?? []) {
    const inviteId = chat.invite_id as string;
    stats[inviteId] ??= blank();
    seenIps[inviteId] ??= new Set();
    // Chats without a stored IP still count once each (keyed by chat id)
    const key = chat.guest_ip || `chat:${chat.id}`;
    if (seenIps[inviteId].has(key)) continue;
    seenIps[inviteId].add(key);
    stats[inviteId].joins += 1;
    const country = (chat.guest_country || "??").toUpperCase();
    stats[inviteId].countries[country] = (stats[inviteId].countries[country] ?? 0) + 1;
  }
  for (const visit of visitsRes.data ?? []) {
    const inviteId = visit.invite_id as string;
    stats[inviteId] ??= blank();
    stats[inviteId].clicks += 1; // rows are already unique per (invite, ip)
  }
  return stats;
}

/** Uppercase ISO-2 codes only; anything else is dropped. */
function countryCodes(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw
        .map((c) => String(c).trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c))
    : [];
}

/** Bare domains get https://; invalid input becomes null. */
function normalizeRedirectUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    return new URL(withProto).toString();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const allowedCountries = countryCodes(body.allowedCountries);
  const redirectUrl = normalizeRedirectUrl(body.redirectUrl);
  const redirectCountries = countryCodes(body.redirectCountries);

  const row = {
    owner_id: ownerId,
    code: nanoid(10),
    label: body.label?.trim() || null,
    allowed_countries: allowedCountries.length > 0 ? allowedCountries : null,
    max_uses: body.maxUses ? Number(body.maxUses) : null,
    expires_at: body.expiresAt || null,
    redirect_url: redirectUrl,
    redirect_countries: redirectCountries.length > 0 ? redirectCountries : null,
  };

  const db = supabaseAdmin();
  let { data, error } = await db.from("invites").insert(row).select().single();

  // redirect_* columns missing (migration not run): creation still works when
  // no redirect was requested — otherwise surface the error so it's noticed.
  if (error && /redirect/i.test(error.message) && !redirectUrl) {
    const { redirect_url: _u, redirect_countries: _c, ...legacyRow } = row;
    ({ data, error } = await db.from("invites").insert(legacyRow).select().single());
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ invite: data });
}

export async function PATCH(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, ids, active, label } = body;

  const updates: {
    active?: boolean;
    label?: string | null;
    allowed_countries?: string[] | null;
    redirect_url?: string | null;
    redirect_countries?: string[] | null;
  } = {};
  if (typeof active === "boolean") updates.active = active;
  if (label !== undefined) updates.label = String(label).trim() || null;
  if (body.allowedCountries !== undefined) {
    const codes = countryCodes(body.allowedCountries);
    updates.allowed_countries = codes.length > 0 ? codes : null;
  }
  if (body.redirectUrl !== undefined) {
    updates.redirect_url = normalizeRedirectUrl(body.redirectUrl);
  }
  if (body.redirectCountries !== undefined) {
    const codes = countryCodes(body.redirectCountries);
    updates.redirect_countries = codes.length > 0 ? codes : null;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Single link or a multi-selected batch
  const targetIds: string[] = Array.isArray(ids) ? ids : id ? [id] : [];
  if (targetIds.length === 0) {
    return NextResponse.json({ error: "id or ids required" }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from("invites")
    .update(updates)
    .in("id", targetIds)
    .eq("owner_id", ownerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  const { error } = await supabaseAdmin()
    .from("invites")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
