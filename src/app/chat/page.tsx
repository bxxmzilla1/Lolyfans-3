import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getGuestChatId } from "@/lib/session";
import { ipFromHeaders } from "@/lib/invites";
import { visitorLocation } from "@/lib/geo";
import { supabaseAdmin } from "@/lib/supabase/admin";
import ChatView from "@/components/ChatView";
import GuestChatHeader from "@/components/GuestChatHeader";
import GuestNav from "@/components/GuestNav";
import GuestPresence from "@/components/GuestPresence";
import OwnerEscapeHatch from "@/components/OwnerEscapeHatch";

export const dynamic = "force-dynamic";

export default async function GuestChatPage() {
  const chatId = await getGuestChatId();
  if (!chatId) redirect("/");

  const db = supabaseAdmin();
  const requestHeaders = await headers();

  // Messages, chat, unlocks, and the guest's location all load at the same time.
  const [{ data: messages }, { data: chat }, { data: unlocks }, location] =
    await Promise.all([
      db
        .from("messages")
        .select("*")
        .eq("chat_id", chatId)
        .eq("hidden", false)
        .order("created_at", { ascending: true })
        .limit(500),
      db
        .from("chats")
        .select("owner_id, guest_ip")
        .eq("id", chatId)
        .maybeSingle(),
      db.from("message_unlocks").select("message_id").eq("chat_id", chatId),
      visitorLocation(requestHeaders),
    ]);
  // Chat was deleted: skip the IP resume so we land on the sign-in page, not a loop
  if (!chat) redirect("/?resume=0");

  const unlockedIds = new Set((unlocks ?? []).map((u) => u.message_id));
  const initialMessages = (messages ?? []).map((m) => ({
    ...m,
    unlocked: unlockedIds.has(m.id),
  }));

  // Keep the remembered IP fresh so this device finds its chat again even
  // after clearing history or switching browsers (IPs drift over time).
  // Done after the response so it never delays the page.
  const currentIp = ipFromHeaders(requestHeaders);
  if (currentIp && chat.guest_ip !== currentIp) {
    after(async () => {
      await db.from("chats").update({ guest_ip: currentIp }).eq("id", chatId);
    });
  }

  // The owner's profile (name + picture) from their auth account; the guest's
  // own location is shown as if the inviter is in the same place.
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
      location={location}
    />
  );

  return (
    // On mobile the footer menu stays visible, so the chat (and its message
    // box) is padded up to sit above it; on desktop the nav is a left sidebar.
    <div className="h-dvh pb-[calc(60px+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-60">
      <GuestPresence chatId={chatId} ownerId={chat.owner_id} />
      <OwnerEscapeHatch />
      <ChatView
        chatId={chatId}
        role="guest"
        header={header}
        initialMessages={initialMessages}
      />
      <GuestNav />
    </div>
  );
}
