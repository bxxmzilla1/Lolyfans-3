import { redirect } from "next/navigation";
import { getGuestChatId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChatAccessDestination } from "@/lib/subscriptionAccess";
import CallScreen from "@/components/CallScreen";
import { CALL_TOKENS_PER_MIN } from "@/lib/voiceCall";

export const dynamic = "force-dynamic";

/**
 * Fan-side voice call page: talk to the creator's AI chatbot live, $1/min.
 * Uses the guest's current chat (same identity as /chat) for billing and
 * for the chatbot's conversation context.
 */
export default async function CallPage() {
  const chatId = await getGuestChatId();
  if (!chatId) redirect("/");

  const access = await guestChatAccessDestination(chatId);
  if (!access.allowed) redirect(access.href);

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("owner_id, token_balance")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) redirect("/api/guest/gone");

  const { data: ownerUser } = await db.auth.admin.getUserById(chat.owner_id);
  const meta = (ownerUser?.user?.user_metadata ?? {}) as {
    display_name?: string;
    avatar_path?: string;
    eleven_voice_id?: string;
  };

  return (
    <CallScreen
      ownerName={meta.display_name || "Lolyfans"}
      avatarPath={meta.avatar_path || null}
      hasTokens={(Number(chat.token_balance) || 0) >= CALL_TOKENS_PER_MIN}
      voiceReady={!!(meta.eleven_voice_id || "").trim()}
    />
  );
}
