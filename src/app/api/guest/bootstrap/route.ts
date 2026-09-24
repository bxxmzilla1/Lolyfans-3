import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { guestChats, ownerProfiles, guestUnreadCounts } from "@/lib/guest";
import { listCreators } from "@/lib/creatorDirectory";
import { messagePreviewText } from "@/lib/utils";
import { guestAccessDestination } from "@/lib/subscriptionAccess";

/**
 * One round-trip for the fan shell: profile, chat list, and the Home creator
 * directory. Lets Home / Chats / Profile stay mounted and switch instantly.
 */
export async function GET(req: NextRequest) {
  const chats = await guestChats(req.headers);
  if (!chats.length) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const cookieChatId = await getGuestChatId();
  const profileChat = chats.find((c) => c.id === cookieChatId) ?? chats[0];

  // Paid profiles: don't hand out the fan shell until they've subscribed.
  const access = await guestAccessDestination(profileChat.id, profileChat.owner_id);
  if (!access.allowed) {
    return NextResponse.json(
      { error: "Subscribe required", paywall: access.href },
      { status: 402 }
    );
  }

  const chatOwnerIds = [...new Set(chats.map((c) => c.owner_id))];
  const [profiles, unread, previews, creators] = await Promise.all([
    ownerProfiles(chatOwnerIds),
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
              : data.media_type === "audio"
                ? "Sent a voice note"
                : "Say hi!");
        return [chat.id, prefix + body] as const;
      })
    ),
    // Home: every creator, the ones this fan already chats with first.
    listCreators(chatOwnerIds),
  ]);

  const previewMap = new Map(previews);

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
    home: { creators },
  });
}
