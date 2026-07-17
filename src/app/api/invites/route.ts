import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const [invitesRes, chatsRes, visitsRes] = await Promise.all([
    db
      .from("invites")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false }),
    db
      .from("chats")
      .select("id, invite_id, guest_country, guest_ip")
      .eq("owner_id", ownerId)
      .not("invite_id", "is", null),
    // Unique-IP page visits per link ("clicks"), scoped to this owner's links
    db
      .from("invite_visits")
      .select("invite_id, invites!inner(owner_id)")
      .eq("invites.owner_id", ownerId),
  ]);
  if (invitesRes.error) {
    return NextResponse.json({ error: invitesRes.error.message }, { status: 500 });
  }

  // Per link: subscribers = people who created a chat (deduplicated by IP —
  // the same device rejoining doesn't count twice), plus their countries.
  type Stats = { joins: number; clicks: number; countries: Record<string, number> };
  const stats: Record<string, Stats> = {};
  const blank = (): Stats => ({ joins: 0, clicks: 0, countries: {} });
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

  return NextResponse.json({
    invites: (invitesRes.data ?? []).map((invite) => ({
      ...invite,
      stats: stats[invite.id] ?? blank(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const allowedCountries: string[] = Array.isArray(body.allowedCountries)
    ? body.allowedCountries
        .map((c: string) => String(c).trim().toUpperCase())
        .filter((c: string) => /^[A-Z]{2}$/.test(c))
    : [];

  const { data, error } = await supabaseAdmin()
    .from("invites")
    .insert({
      owner_id: ownerId,
      code: nanoid(10),
      label: body.label?.trim() || null,
      allowed_countries: allowedCountries.length > 0 ? allowedCountries : null,
      max_uses: body.maxUses ? Number(body.maxUses) : null,
      expires_at: body.expiresAt || null,
    })
    .select()
    .single();

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
  } = {};
  if (typeof active === "boolean") updates.active = active;
  if (label !== undefined) updates.label = String(label).trim() || null;
  if (body.allowedCountries !== undefined) {
    const codes: string[] = Array.isArray(body.allowedCountries)
      ? body.allowedCountries
          .map((c: string) => String(c).trim().toUpperCase())
          .filter((c: string) => /^[A-Z]{2}$/.test(c))
      : [];
    updates.allowed_countries = codes.length > 0 ? codes : null;
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
