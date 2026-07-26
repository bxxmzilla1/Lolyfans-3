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
    welcome_voice_path?: string;
  };
  const text = (meta.welcome_text || "").trim();
  const mediaPath = meta.welcome_media_path || null;
  const voicePath = meta.welcome_voice_path || null;
  if (!meta.welcome_enabled || (!text && !mediaPath && !voicePath)) return;

  // Up to two bubbles: the text/media message, then the voice note — so the
  // voice can stand in for a written caption while media rides along.
  const inserts: {
    chat_id: string;
    sender: "owner";
    content: string | null;
    media_path: string | null;
    media_type: "image" | "video" | "audio" | null;
  }[] = [];
  if (text || mediaPath) {
    inserts.push({
      chat_id: chatId,
      sender: "owner",
      content: text || null,
      media_path: mediaPath,
      media_type: mediaPath
        ? meta.welcome_media_type === "video"
          ? "video"
          : "image"
        : null,
    });
  }
  if (voicePath) {
    inserts.push({
      chat_id: chatId,
      sender: "owner",
      content: null,
      media_path: voicePath,
      media_type: "audio",
    });
  }

  const { data: messages } = await db.from("messages").insert(inserts).select();
  const sent = messages ?? [];
  const last = sent[sent.length - 1];
  if (!last) return;

  await Promise.all([
    db
      .from("chats")
      .update({
        last_message_at: last.created_at,
        last_read_at: last.created_at,
        bot_replied_at: last.created_at,
      })
      .eq("id", chatId),
    ...sent.map((m) => broadcast(`chat:${chatId}`, "new-message", m)),
    broadcast(`inbox:${ownerId}`, "new-message", { chatId }),
  ]);
}
