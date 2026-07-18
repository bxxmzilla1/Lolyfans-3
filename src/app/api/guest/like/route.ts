import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats } from "@/lib/guest";
import { getGuestChatId } from "@/lib/session";

/** Like or unlike a post (one like per guest per post). */
export async function POST(req: NextRequest) {
  const { postId, like } = await req.json();
  if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });

  const chats = await guestChats(req.headers);
  if (!chats.length) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cookieChatId = await getGuestChatId();
  const anchor = chats.find((c) => c.id === cookieChatId) ?? chats[0];
  const db = supabaseAdmin();

  if (like) {
    const { error } = await db
      .from("post_likes")
      .upsert({ post_id: postId, chat_id: anchor.id }, { onConflict: "post_id,chat_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await db
      .from("post_likes")
      .delete()
      .eq("post_id", postId)
      .in("chat_id", chats.map((c) => c.id));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, liked: !!like });
}
