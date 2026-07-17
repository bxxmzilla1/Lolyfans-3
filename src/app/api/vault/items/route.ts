import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const albumId = req.nextUrl.searchParams.get("albumId");

  // Filtering by album: resolve member item ids first so each returned item
  // still carries its complete album membership list.
  let itemIds: string[] | null = null;
  if (albumId) {
    const { data: links } = await db
      .from("vault_item_albums")
      .select("item_id")
      .eq("album_id", albumId);
    itemIds = (links ?? []).map((l) => l.item_id);
    if (itemIds.length === 0) return NextResponse.json({ items: [] });
  }

  let query = db
    .from("vault_items")
    .select("*, vault_item_albums(album_id)")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (itemIds) query = query.in("id", itemIds);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data ?? []).map(({ vault_item_albums, ...item }) => ({
    ...item,
    albums: ((vault_item_albums ?? []) as { album_id: string }[]).map((a) => a.album_id),
  }));
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { mediaPath, mediaType, albumId } = await req.json();
  if (!mediaPath || !mediaType) {
    return NextResponse.json({ error: "mediaPath and mediaType required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("vault_items")
    .insert({
      owner_id: ownerId,
      media_path: mediaPath,
      media_type: mediaType,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (albumId) {
    await db.from("vault_item_albums").insert({ item_id: data.id, album_id: albumId });
  }
  return NextResponse.json({ item: data });
}

/** Add or remove the given items from an album (multi-select checklist). */
export async function PATCH(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ids, albumId, member } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0 || !albumId) {
    return NextResponse.json({ error: "ids and albumId required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const [{ data: album }, { data: owned }] = await Promise.all([
    db.from("vault_albums").select("id").eq("id", albumId).eq("owner_id", ownerId).single(),
    db.from("vault_items").select("id").in("id", ids).eq("owner_id", ownerId),
  ]);
  if (!album) return NextResponse.json({ error: "Album not found" }, { status: 404 });
  const ownedIds = (owned ?? []).map((o) => o.id);
  if (ownedIds.length === 0) return NextResponse.json({ error: "No items" }, { status: 404 });

  if (member) {
    const { error } = await db
      .from("vault_item_albums")
      .upsert(
        ownedIds.map((item_id) => ({ item_id, album_id: albumId })),
        { onConflict: "item_id,album_id", ignoreDuplicates: true }
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await db
      .from("vault_item_albums")
      .delete()
      .eq("album_id", albumId)
      .in("item_id", ownedIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Accepts a single id or an array of ids (multi-select delete)
  const { id, ids } = await req.json();
  const targetIds: string[] = Array.isArray(ids) ? ids : id ? [id] : [];
  if (targetIds.length === 0) {
    return NextResponse.json({ error: "id or ids required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: items } = await db
    .from("vault_items")
    .select("media_path")
    .in("id", targetIds)
    .eq("owner_id", ownerId);
  const { error } = await db
    .from("vault_items")
    .delete()
    .in("id", targetIds)
    .eq("owner_id", ownerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const paths = (items ?? []).map((i) => i.media_path).filter(Boolean);
  if (paths.length > 0) {
    await db.storage.from("media").remove(paths);
  }
  return NextResponse.json({ ok: true });
}
