import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

/** Set the base like count shown on one of the owner's posts. */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { postId, likeCount } = await req.json();
  const count = Math.max(0, Math.floor(Number(likeCount) || 0));
  if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from("posts")
    .update({ like_count: count })
    .eq("id", postId)
    .eq("owner_id", ownerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, likeCount: count });
}
