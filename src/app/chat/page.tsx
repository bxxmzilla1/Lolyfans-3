import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getGuestChatId } from "@/lib/session";
import { ipFromHeaders } from "@/lib/invites";
import { visitorLocation } from "@/lib/geo";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChatAccessDestination } from "@/lib/subscriptionAccess";
import ChatView from "@/components/ChatView";
import GuestChatHeader from "@/components/GuestChatHeader";
import GuestNav from "@/components/GuestNav";
import GuestPresence from "@/components/GuestPresence";
import CpmMeter from "@/components/CpmMeter";
import OwnerEscapeHatch from "@/components/OwnerEscapeHatch";
import { activeCpmSession, startCpmSession } from "@/lib/cpm";

export const dynamic = "force-dynamic";

export default async function GuestChatPage() {
  const chatId = await getGuestChatId();
  if (!chatId) redirect("/");

  // Paid profiles: no chat until the subscription is confirmed.
  const access = await guestChatAccessDestination(chatId);
  if (!access.allowed) redirect(access.href);

  const db = supabaseAdmin();
  const requestHeaders = await headers();

  // Messages, chat, unlocks, and the guest's location all load at the same time.
  const [{ data: messages }, { data: chat }, { data: unlocks }, location] =
    await Promise.all([
      // Newest 500, flipped to chronological below — ascending+limit would
      // freeze the view at the oldest 500 once a chat grows past that.
      db
        .from("messages")
        .select("*")
        .eq("chat_id", chatId)
        .eq("hidden", false)
        .order("created_at", { ascending: false })
        .limit(500),
      // "*" so the page keeps working even before the owner_appears_offline
      // column migration has been applied.
      db.from("chats").select("*").eq("id", chatId).maybeSingle(),
      db.from("message_unlocks").select("message_id").eq("chat_id", chatId),
      visitorLocation(requestHeaders),
    ]);
  // Chat was deleted by the creator: clear the dead session and send them to
  // the public home page.
  if (!chat) redirect("/api/guest/gone");

  const unlockedIds = new Set((unlocks ?? []).map((u) => u.message_id));
  const initialMessages = (messages ?? [])
    .slice()
    .reverse()
    // Media the fan rejected at the incoming gate is gone for them for good.
    .filter((m) => m.fan_decision !== "rejected")
    .map((m) => ({
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
    invite_verified?: boolean;
    eleven_voice_id?: string;
  };

  const header = (
    <GuestChatHeader
      chatId={chatId}
      name={meta.display_name || "Lolyfans"}
      avatarPath={meta.avatar_path || null}
      location={location}
      verified={!!meta.invite_verified}
      initialOnline={!chat.owner_appears_offline}
      // Voice calls only exist once the creator saved an ElevenLabs voice —
      // and never on Chat-per-minute chats (text chat only there).
      callHref={
        !chat.cpm && (meta.eleven_voice_id || "").trim() ? "/call" : undefined
      }
    />
  );

  // Chat-per-minute: metering starts the moment the chat loads (not on the
  // first message). Claim already started a session for brand-new pays; this
  // covers returning fans reopening /chat.
  if (
    chat.cpm &&
    chat.stripe_payment_method_id &&
    !(await activeCpmSession(chatId))
  ) {
    await startCpmSession({ chatId, ownerId: chat.owner_id });
  }

  return (
    // On mobile the footer menu stays visible, so the chat (and its message
    // box) is padded up to sit above it; on desktop the nav is a left sidebar.
    // 42px matches the icon-only footer height (24px icon + 16px padding + border)
    <div className="h-dvh pb-[calc(42px+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-60">
      <GuestPresence chatId={chatId} ownerId={chat.owner_id} />
      {chat.cpm ? <CpmMeter chatId={chatId} /> : null}
      <OwnerEscapeHatch />
      <ChatView
        chatId={chatId}
        role="guest"
        header={header}
        initialMessages={initialMessages}
        ownerId={chat.owner_id}
        peerName={meta.display_name || "Lolyfans"}
      />
      <GuestNav />
    </div>
  );
}
