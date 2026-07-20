import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestAccessDestination } from "@/lib/subscriptionAccess";

/**
 * Shared invite-page resume: if this visitor already has a chat (cookie or
 * IP), send them to /chat when allowed, or back to the payment step when the
 * creator's profile is still unpaid.
 */
export async function resumeHrefForChatId(chatId: string): Promise<string> {
  const { data: chat } = await supabaseAdmin()
    .from("chats")
    .select("owner_id")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) return "/?resume=0";
  return (await guestAccessDestination(chatId, chat.owner_id)).href;
}
