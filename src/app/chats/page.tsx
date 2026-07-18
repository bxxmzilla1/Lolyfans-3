import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats, ownerProfiles, guestUnreadCounts } from "@/lib/guest";
import GuestNav from "@/components/GuestNav";
import GuestChatList, { type GuestChatRow } from "@/components/GuestChatList";

export const dynamic = "force-dynamic";

/** Guest chat list: every conversation this device has, with unread badges. */
export default async function GuestChatsPage() {
  const requestHeaders = await headers();
  const chats = await guestChats(requestHeaders);
  if (!chats.length) redirect("/");

  const db = supabaseAdmin();

  const [profiles, unread, previews] = await Promise.all([
    ownerProfiles(chats.map((c) => c.owner_id)),
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
        const body =
          data.content ||
          (data.media_type === "video" ? "Sent a video" : "Sent a photo");
        return [chat.id, prefix + body] as const;
      })
    ),
  ]);
  const previewMap = new Map(previews);

  const rows: GuestChatRow[] = chats.map((chat) => {
    const p = profiles.get(chat.owner_id);
    return {
      id: chat.id,
      ownerName: p?.name || "Lolyfans",
      ownerAvatar: p?.avatarPath || null,
      verified: !!p?.verified,
      preview: previewMap.get(chat.id) || "Say hi!",
      lastMessageAt: chat.last_message_at,
      unread: unread.get(chat.id) ?? 0,
    };
  });

  return (
    <div className="min-h-dvh pb-[calc(88px+env(safe-area-inset-bottom))] lg:pb-8 lg:pl-60">
      <header className="sticky top-0 z-30 border-b border-line2 bg-card/80 backdrop-blur-lg px-4 py-3">
        <h1 className="max-w-lg mx-auto font-bold text-lg">Chats</h1>
      </header>
      <main className="max-w-lg mx-auto">
        <GuestChatList chats={rows} />
      </main>
      <GuestNav />
    </div>
  );
}
