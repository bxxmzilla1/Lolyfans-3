import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import ChatView from "@/components/ChatView";
import { IconBack } from "@/components/Icons";

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
  const [{ data: chat }, { data: messages }] = await Promise.all([
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
  ]);
  if (!chat) notFound();

  const header = (
    <header className="border-b border-line px-3 py-2.5 flex items-center gap-3 bg-card/60 backdrop-blur-lg">
      <Link href="/inbox" className="lg:hidden text-fg p-1" aria-label="Back">
        <IconBack className="w-5 h-5" />
      </Link>
      <div className="ig-ring">
        <div className="w-9 h-9 rounded-full bg-bg flex items-center justify-center font-bold uppercase text-sm">
          {chat.guest_name.slice(0, 1)}
        </div>
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-[15px] truncate">{chat.guest_name}</p>
        <p className="text-muted text-xs truncate">
          {chat.guest_country ? `${chat.guest_country} · ` : ""}
          {chat.invites?.label || "Invite link"}
        </p>
      </div>
    </header>
  );

  return (
    <ChatView
      chatId={chatId}
      role="owner"
      header={header}
      initialMessages={messages ?? []}
    />
  );
}
