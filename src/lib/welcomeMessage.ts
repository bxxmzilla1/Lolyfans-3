import { supabaseAdmin } from "@/lib/supabase/admin";
import { broadcast } from "@/lib/realtime";

/**
 * If the creator configured a welcome message (Settings → Welcome), drop it
 * into the chat as their first message — only when the chat has no owner
 * messages yet (so paid-profile fans get it after they subscribe, not twice).
 */
export async function sendWelcomeMessageIfNeeded(chatId: string, ownerId: string) {
  const db = supabaseAdmin();
  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("chat_id", chatId)
    .eq("sender", "owner");
  if ((count ?? 0) > 0) return;

  const { data: ownerUser } = await db.auth.admin.getUserById(ownerId);
  const meta = (ownerUser?.user?.user_metadata ?? {}) as {
    welcome_enabled?: boolean;
    welcome_text?: string;
    welcome_media_path?: string;
    welcome_media_type?: string;
  };
  const text = (meta.welcome_text || "").trim();
  const mediaPath = meta.welcome_media_path || null;
  if (!meta.welcome_enabled || (!text && !mediaPath)) return;

  const { data: message } = await db
    .from("messages")
    .insert({
      chat_id: chatId,
      sender: "owner",
      content: text || null,
      media_path: mediaPath,
      media_type: mediaPath
        ? meta.welcome_media_type === "video"
          ? "video"
          : "image"
        : null,
    })
    .select()
    .single();
  if (!message) return;

  await Promise.all([
    db
      .from("chats")
      .update({
        last_message_at: message.created_at,
        last_read_at: message.created_at,
        bot_replied_at: message.created_at,
      })
      .eq("id", chatId),
    broadcast(`chat:${chatId}`, "new-message", message),
    broadcast(`inbox:${ownerId}`, "new-message", { chatId }),
  ]);
}
