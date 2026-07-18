import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats } from "@/lib/guest";
import { getGuestChatId } from "@/lib/session";

/** Comments on a post, oldest first, with commenter avatars where known. */
export async function GET(req: NextRequest) {
  const postId = req.nextUrl.searchParams.get("postId");
  if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: rows } = await db
    .from("post_comments")
    .select("id, chat_id, author_name, body, created_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .limit(500);

  // Avatars for guest commenters (seeded comments have no chat).
  const chatIds = [...new Set((rows ?? []).map((r) => r.chat_id).filter(Boolean))];
  const avatars = new Map<string, string | null>();
  if (chatIds.length) {
    const { data: chats } = await db
      .from("chats")
      .select("id, guest_avatar_path")
      .in("id", chatIds);
    for (const c of chats ?? []) avatars.set(c.id, c.guest_avatar_path);
  }

  return NextResponse.json({
    comments: (rows ?? []).map((r) => ({
      id: r.id,
      author: r.author_name,
      avatarPath: r.chat_id ? avatars.get(r.chat_id) ?? null : null,
      body: r.body,
      createdAt: r.created_at,
    })),
  });
}

/** Add a comment as the signed-in guest. */
export async function POST(req: NextRequest) {
  const { postId, body } = await req.json();
  const text = String(body || "").trim().slice(0, 500);
  if (!postId || !text) {
    return NextResponse.json({ error: "postId and body required" }, { status: 400 });
  }

  const chats = await guestChats(req.headers);
  if (!chats.length) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cookieChatId = await getGuestChatId();
  const anchor = chats.find((c) => c.id === cookieChatId) ?? chats[0];

  const { data: comment, error } = await supabaseAdmin()
    .from("post_comments")
    .insert({
      post_id: postId,
      chat_id: anchor.id,
      author_name: anchor.guest_name,
      body: text,
    })
    .select("id, author_name, body, created_at")
    .single();
  if (error || !comment) {
    return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });
  }

  return NextResponse.json({
    comment: {
      id: comment.id,
      author: comment.author_name,
      avatarPath: anchor.guest_avatar_path,
      body: comment.body,
      createdAt: comment.created_at,
    },
  });
}
