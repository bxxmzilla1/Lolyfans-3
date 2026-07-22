import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { locationFromIp, fullCountryName } from "@/lib/geo";
import ChatView from "@/components/ChatView";
import GuestPresenceStatus from "@/components/GuestPresenceStatus";
import { IconBack, IconMapPin, IconTip } from "@/components/Icons";

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
  const [{ data: chat }, { data: messages }, { data: unlocks }] = await Promise.all([
    db
      .from("chats")
      .select("*, invites(label)")
      .eq("id", chatId)
      .eq("owner_id", ownerId)
      .single(),
    db
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(500),
    // Paid unlocks tint the creator's own bubble green.
    db.from("message_unlocks").select("message_id").eq("chat_id", chatId),
    // Opening the chat marks it as read (clears the sidebar badge)
    db
      .from("chats")
      .update({ last_read_at: new Date().toISOString() })
      .eq("id", chatId)
      .eq("owner_id", ownerId),
  ]);
  if (!chat) notFound();

  const unlockedIds = new Set((unlocks ?? []).map((u) => u.message_id as string));
  const initialMessages = (messages ?? []).map((m) => ({
    ...m,
    unlocked: unlockedIds.has(m.id),
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
          <span className="truncate">
            {chat.custom_name || chat.guest_name}
            {chat.custom_name && (
              <span className="text-muted text-xs font-normal ml-1.5">
                {chat.guest_name}
              </span>
            )}
          </span>
          {/* Fan's token balance — how much they can spend right now */}
          <span
            className="inline-flex items-center gap-1 rounded-full bg-accent/10 text-accent text-[11px] font-bold px-2 py-0.5 shrink-0"
            title="Fan's token balance"
          >
            <IconTip className="w-3 h-3" />
            {((chat.token_balance as number | null) ?? 0).toLocaleString("en-US")}
          </span>
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
