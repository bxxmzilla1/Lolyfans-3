import { redirect } from "next/navigation";
import Link from "next/link";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { locationFromIp, fullCountryName } from "@/lib/geo";
import ChatView from "@/components/ChatView";
import GuestPresenceStatus from "@/components/GuestPresenceStatus";
import OwnerOnlineSwitch from "@/components/OwnerOnlineSwitch";
import FanWalletStatus from "@/components/FanWalletStatus";
import PpmAcceptedBadge from "@/components/PpmAcceptedBadge";
import PpmFreeLeft from "@/components/PpmFreeLeft";
import { payPerMessageFromMetadata } from "@/lib/payPerMessage";
import { IconBack, IconMapPin } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function OwnerChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>;
}) {
  const ownerId = await getOwnerId();
  if (!ownerId) redirect("/");
  const { chatId } = await params;

  const db = supabaseAdmin();
  const [
    { data: chat },
    { data: messages },
    { data: unlocks },
    { data: drains },
    { data: ownerUser },
  ] = await Promise.all([
    db
      .from("chats")
      .select("*, invites(label)")
      .eq("id", chatId)
      .eq("owner_id", ownerId)
      .single(),
    // Newest 500, flipped to chronological below — ascending+limit would
    // freeze the view at the oldest 500 once a chat grows past that.
    db
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(500),
    // Paid unlocks tint the creator's own bubble green.
    db.from("message_unlocks").select("message_id").eq("chat_id", chatId),
    // BlurDrainer taps: green bubble + tapped-layer count on own videos.
    db
      .from("message_blur_progress")
      .select("message_id, layers_cleared")
      .eq("chat_id", chatId),
    db.auth.admin.getUserById(ownerId),
    // Opening the chat marks it as read (clears the sidebar badge)
    db
      .from("chats")
      .update({ last_read_at: new Date().toISOString() })
      .eq("id", chatId)
      .eq("owner_id", ownerId),
  ]);
  // Chat gone (e.g. deleted via guest exit) — back to the inbox instead of
  // stranding the creator on a 404.
  if (!chat) redirect("/inbox");

  const ppm = payPerMessageFromMetadata(ownerUser?.user?.user_metadata ?? {});

  const unlockedIds = new Set((unlocks ?? []).map((u) => u.message_id as string));
  const drainMap = new Map(
    (drains ?? []).map((d) => [d.message_id as string, d.layers_cleared as number])
  );
  const initialMessages = (messages ?? [])
    .slice()
    .reverse()
    .map((m) => ({
      ...m,
      unlocked: unlockedIds.has(m.id),
      ...(drainMap.has(m.id) ? { blur_layers_cleared: drainMap.get(m.id) } : {}),
    }));

  // Where the guest is chatting from: precise City, Country from their IP,
  // falling back to the country stored when they joined.
  const guestLocation =
    (await locationFromIp(chat.guest_ip)) ?? fullCountryName(chat.guest_country);

  const header = (
    <header className="border-b border-line2 px-3 py-2.5 flex items-center gap-3 bg-card/60 backdrop-blur-lg">
      <Link href="/inbox" className="lg:hidden text-fg p-1" aria-label="Back">
        <IconBack className="w-5 h-5" />
      </Link>
      <div className="ig-ring">
        <div className="w-9 h-9 rounded-full bg-bg flex items-center justify-center font-bold uppercase text-sm">
          {(chat.custom_name || chat.guest_name).slice(0, 1)}
        </div>
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-[15px] truncate flex items-center gap-1.5">
          {/* Shield: this fan accepted the pay-per-message agreement (live) */}
          <PpmAcceptedBadge
            chatId={chatId}
            initialAccepted={!!chat.ppm_accepted_at}
          />
          {/* Card icon (once registered) + name */}
          <FanWalletStatus
            chatId={chatId}
            initialHasCard={!!chat.stripe_payment_method_id}
          >
            <span className="truncate">
              {chat.custom_name || chat.guest_name}
              {chat.custom_name && (
                <span className="text-muted text-xs font-normal ml-1.5">
                  {chat.guest_name}
                </span>
              )}
            </span>
          </FanWalletStatus>
          <PpmFreeLeft
            chatId={chatId}
            initialEnabled={ppm.enabled}
            initialCreditCents={chat.ppm_credit_cents ?? 0}
          />
        </p>
        <p className="text-muted text-xs truncate flex items-center gap-1.5">
          {guestLocation && (
            <>
              <span className="flex items-center gap-1 min-w-0">
                <IconMapPin className="w-3 h-3 text-accent shrink-0" />
                <span className="truncate">{guestLocation}</span>
              </span>
              <span className="shrink-0">·</span>
            </>
          )}
          <GuestPresenceStatus chatId={chatId} ownerId={ownerId} />
        </p>
      </div>
      {/* How this fan sees YOU: online (default) or offline — per chat */}
      <div className="ml-auto">
        <OwnerOnlineSwitch
          chatId={chatId}
          initialOnline={!chat.owner_appears_offline}
        />
      </div>
    </header>
  );

  return (
    <ChatView
      chatId={chatId}
      role="owner"
      header={header}
      initialMessages={initialMessages}
    />
  );
}
