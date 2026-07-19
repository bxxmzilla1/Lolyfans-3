import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { guestChats, ownerProfiles, guestUnreadCounts } from "@/lib/guest";
import { postStats } from "@/lib/posts";
import { mediaUrl, messagePreviewText } from "@/lib/utils";

/**
 * One round-trip for the fan shell: profile, chat list, and home feed.
 * Lets Home / Chats / Profile stay mounted and switch instantly.
 */
export async function GET(req: NextRequest) {
  const chats = await guestChats(req.headers);
  if (!chats.length) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const chatIds = chats.map((c) => c.id);
  const cookieChatId = await getGuestChatId();
  const profileChat = chats.find((c) => c.id === cookieChatId) ?? chats[0];

  const { data: followRows } = await db
    .from("follows")
    .select("owner_id")
    .in("chat_id", chatIds);
  const followed = [...new Set((followRows ?? []).map((r) => r.owner_id as string))];

  const [{ data: posts }, profiles, unread, previews] = await Promise.all([
    followed.length
      ? db
          .from("posts")
          .select("*")
          .in("owner_id", followed)
          .order("created_at", { ascending: false })
          .limit(60)
      : Promise.resolve({ data: [] as never[] }),
    ownerProfiles([...followed, ...chats.map((c) => c.owner_id)]),
    guestUnreadCounts(chats),
    Promise.all(
      chats.map(async (chat) => {
        const { data } = await db
          .from("messages")
          .select("content, media_type, sender")
          .eq("chat_id", chat.id)
          .eq("hidden", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!data) return [chat.id, "Say hi!"] as const;
        const prefix = data.sender === "guest" ? "You: " : "";
        const text = data.content ? messagePreviewText(data.content) : "";
        const body =
          text ||
          (data.media_type === "video"
            ? "Sent a video"
            : data.media_type === "image"
              ? "Sent a photo"
              : "Say hi!");
        return [chat.id, prefix + body] as const;
      })
    ),
  ]);

  const stats = await postStats(
    (posts ?? []).map((p) => p.id),
    chatIds
  );
  const previewMap = new Map(previews);

  const suggestions = [...new Set(chats.map((c) => c.owner_id))]
    .filter((id) => !followed.includes(id))
    .map((id) => {
      const p = profiles.get(id);
      return {
        ownerId: id,
        name: p?.name || "Lolyfans",
        avatarPath: p?.avatarPath || null,
        verified: !!p?.verified,
      };
    });

  const feedPosts = (posts ?? []).map((post) => {
    const p = profiles.get(post.owner_id);
    return {
      id: post.id,
      ownerId: post.owner_id,
      ownerName: p?.name || "Lolyfans",
      ownerAvatar: p?.avatarPath || null,
      verified: !!p?.verified,
      url: mediaUrl(post.media_path),
      type: post.media_type as "image" | "video",
      caption: post.caption,
      createdAt: post.created_at,
      likes: (post.like_count ?? 0) + (stats.likes.get(post.id) ?? 0),
      comments: stats.comments.get(post.id) ?? 0,
      liked: stats.likedByMe.has(post.id),
    };
  });

  const chatRows = chats.map((chat) => {
    const p = profiles.get(chat.owner_id);
    return {
      id: chat.id,
      ownerId: chat.owner_id,
      ownerName: p?.name || "Lolyfans",
      ownerAvatar: p?.avatarPath || null,
      verified: !!p?.verified,
      preview: previewMap.get(chat.id) || "Say hi!",
      lastMessageAt: chat.last_message_at,
      unread: unread.get(chat.id) ?? 0,
    };
  });

  const totalUnread = chatRows.reduce((a, c) => a + c.unread, 0);

  return NextResponse.json({
    profile: {
      name: profileChat.guest_name,
      avatarPath: profileChat.guest_avatar_path,
    },
    chats: chatRows,
    unread: totalUnread,
    home: {
      suggestions,
      posts: feedPosts,
      canInteract: chats.length > 0,
    },
  });
}
