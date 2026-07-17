import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin()
    .from("chat_categories")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ categories: data });
}

export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const { data, error } = await supabaseAdmin()
    .from("chat_categories")
    .insert({ owner_id: ownerId, name: name.trim() })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: data });
}

/** Add or remove the given chats from a category (multi-select checklist). */
export async function PATCH(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatIds, categoryId, member } = await req.json();
  if (!Array.isArray(chatIds) || chatIds.length === 0 || !categoryId) {
    return NextResponse.json({ error: "chatIds and categoryId required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const [{ data: category }, { data: owned }] = await Promise.all([
    db.from("chat_categories").select("id").eq("id", categoryId).eq("owner_id", ownerId).single(),
    db.from("chats").select("id").in("id", chatIds).eq("owner_id", ownerId),
  ]);
  if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  const ownedIds = (owned ?? []).map((c) => c.id);
  if (ownedIds.length === 0) return NextResponse.json({ error: "No chats" }, { status: 404 });

  if (member) {
    const { error } = await db
      .from("chat_category_members")
      .upsert(
        ownedIds.map((chat_id) => ({ chat_id, category_id: categoryId })),
        { onConflict: "chat_id,category_id", ignoreDuplicates: true }
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await db
      .from("chat_category_members")
      .delete()
      .eq("category_id", categoryId)
      .in("chat_id", ownedIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  const { error } = await supabaseAdmin()
    .from("chat_categories")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
