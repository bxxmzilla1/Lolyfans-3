import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

/** The owner's own posts, newest first. */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin()
    .from("posts")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ posts: data ?? [] });
}

/** Publish a new post (media already uploaded to storage). */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { mediaPath, mediaType, caption } = await req.json();
  if (!mediaPath || !["image", "video"].includes(mediaType)) {
    return NextResponse.json({ error: "Media required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("posts")
    .insert({
      owner_id: ownerId,
      media_path: mediaPath,
      media_type: mediaType,
      caption: String(caption || "").trim().slice(0, 500) || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post: data });
}

/** Delete one of the owner's posts. */
export async function DELETE(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from("posts")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
