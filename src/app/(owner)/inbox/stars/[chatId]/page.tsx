import { redirect } from "next/navigation";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import StarsChatView from "@/components/StarsChatView";

export const dynamic = "force-dynamic";

export default async function StarsInboxChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>;
}) {
  const ownerId = await getOwnerId();
  if (!ownerId) redirect("/creator");
  const { chatId } = await params;

  const { data: chat } = await supabaseAdmin()
    .from("stars_chats")
    .select("id, username, first_name, last_name, tg_user_id")
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (!chat) redirect("/inbox");

  const title =
    [chat.first_name, chat.last_name].filter(Boolean).join(" ") ||
    (chat.username ? `@${chat.username}` : `User ${chat.tg_user_id}`);

  return <StarsChatView chatId={chatId} title={title} />;
}
