import { redirect } from "next/navigation";
import { getGuestChatId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import ChatView from "@/components/ChatView";

export const dynamic = "force-dynamic";

export default async function GuestChatPage() {
  const chatId = await getGuestChatId();
  if (!chatId) redirect("/");

  const { data: messages } = await supabaseAdmin()
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })
    .limit(500);

  const header = (
    <header className="border-b border-line px-4 py-3 flex items-center gap-3 bg-card/60 backdrop-blur-lg">
      <div className="ig-ring">
        <div className="w-9 h-9 rounded-full bg-bg flex items-center justify-center text-lg">
          💬
        </div>
      </div>
      <div>
        <p className="font-bold ig-gradient-text text-lg leading-tight">Lolyfans</p>
        <p className="text-muted text-xs">Private chat</p>
      </div>
    </header>
  );

  return (
    <div className="h-dvh">
      <ChatView
        chatId={chatId}
        role="guest"
        header={header}
        initialMessages={messages ?? []}
      />
    </div>
  );
}
