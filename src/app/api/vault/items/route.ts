import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const albumId = req.nextUrl.searchParams.get("albumId");
  let query = supabaseAdmin()
    .from("vault_items")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (albumId === "none") query = query.is("album_id", null);
  else if (albumId) query = query.eq("album_id", albumId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data });
}

export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { mediaPath, mediaType, albumId } = await req.json();
  if (!mediaPath || !mediaType) {
    return NextResponse.json({ error: "mediaPath and mediaType required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("vault_items")
    .insert({
      owner_id: ownerId,
      media_path: mediaPath,
      media_type: mediaType,
      album_id: albumId || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function PATCH(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Accepts a single id or an array of ids (multi-select moves)
  const { id, ids, albumId } = await req.json();
  const targetIds: string[] = Array.isArray(ids) ? ids : id ? [id] : [];
  if (targetIds.length === 0) {
    return NextResponse.json({ error: "id or ids required" }, { status: 400 });
  }
  const { error } = await supabaseAdmin()
    .from("vault_items")
    .update({ album_id: albumId || null })
    .in("id", targetIds)
    .eq("owner_id", ownerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  const db = supabaseAdmin();
  const { data: item } = await db
    .from("vault_items")
    .select("media_path")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .single();
  const { error } = await db
    .from("vault_items")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (item?.media_path) {
    await db.storage.from("media").remove([item.media_path]);
  }
  return NextResponse.json({ ok: true });
}
