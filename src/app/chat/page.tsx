import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getGuestChatId } from "@/lib/session";
import { ipFromHeaders } from "@/lib/invites";
import { visitorLocation } from "@/lib/geo";
import { supabaseAdmin } from "@/lib/supabase/admin";
import ChatView from "@/components/ChatView";
import GuestChatHeader from "@/components/GuestChatHeader";
import GuestFooter from "@/components/GuestFooter";
import GuestPresence from "@/components/GuestPresence";
import OwnerEscapeHatch from "@/components/OwnerEscapeHatch";

export const dynamic = "force-dynamic";

export default async function GuestChatPage() {
  const chatId = await getGuestChatId();
  if (!chatId) redirect("/");

  const db = supabaseAdmin();
  const requestHeaders = await headers();

  // Messages, chat, and the guest's location all load at the same time.
  const [{ data: messages }, { data: chat }, location] = await Promise.all([
    db
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .eq("hidden", false)
      .order("created_at", { ascending: true })
      .limit(500),
    db.from("chats").select("owner_id, guest_ip").eq("id", chatId).maybeSingle(),
    visitorLocation(requestHeaders),
  ]);
  // Chat was deleted: skip the IP resume so we land on the sign-in page, not a loop
  if (!chat) redirect("/?resume=0");

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
    // box) is padded up to sit above it; on desktop the footer is hidden.
    <div className="h-dvh pb-[calc(60px+env(safe-area-inset-bottom))] lg:pb-0">
      {/* Guests default to light mode unless they flipped the header switch */}
      <script
        dangerouslySetInnerHTML={{
          __html: `try{if(localStorage.getItem('theme')!=='dark'){document.documentElement.classList.add('light');}}catch(e){document.documentElement.classList.add('light');}`,
        }}
      />
      <GuestPresence chatId={chatId} ownerId={chat.owner_id} />
      <OwnerEscapeHatch />
      <ChatView
        chatId={chatId}
        role="guest"
        header={header}
        initialMessages={messages ?? []}
      />
      <div className="lg:hidden">
        <GuestFooter />
      </div>
    </div>
  );
}
