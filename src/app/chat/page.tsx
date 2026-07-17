import { redirect } from "next/navigation";
import { getGuestChatId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import ChatView from "@/components/ChatView";
import GuestChatHeader from "@/components/GuestChatHeader";
import OwnerEscapeHatch from "@/components/OwnerEscapeHatch";

export const dynamic = "force-dynamic";

export default async function GuestChatPage() {
  const chatId = await getGuestChatId();
  if (!chatId) redirect("/");

  const db = supabaseAdmin();
  const [{ data: messages }, { data: chat }] = await Promise.all([
    db
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .eq("hidden", false)
      .order("created_at", { ascending: true })
      .limit(500),
    db.from("chats").select("owner_id").eq("id", chatId).maybeSingle(),
  ]);
  // Chat was deleted: skip the IP resume so we land on the sign-in page, not a loop
  if (!chat) redirect("/?resume=0");

  // The owner's profile (name + picture) from their auth account
  const { data: ownerUser } = await db.auth.admin.getUserById(chat.owner_id);
  const meta = (ownerUser?.user?.user_metadata ?? {}) as {
    display_name?: string;
    avatar_path?: string;
  };

  const header = (
    <GuestChatHeader
      ownerId={chat.owner_id}
      name={meta.display_name || "Lolyfans"}
      avatarPath={meta.avatar_path || null}
    />
  );

  return (
    <div className="h-dvh">
      <OwnerEscapeHatch />
      <ChatView
        chatId={chatId}
        role="guest"
        header={header}
        initialMessages={messages ?? []}
      />
    </div>
  );
}
