import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyUserGeoTokens } from "@/lib/geo";

type WelcomeGeo = { city: string | null; country: string | null };

/** Settings → Chat: the creator's opening message on their chat screen. */
export type ChatWelcome = {
  text: string | null;
  mediaPath: string | null;
  mediaType: "image" | "video" | null;
  /** Blur the media for visitors until they've signed up (and paid, if paid). */
  blur: boolean;
};

export const DEFAULT_WELCOME_TEXT = "Hey, welcome to my private chat. Sign up and say hi!";

export function welcomeFromMetadata(meta: Record<string, unknown>): ChatWelcome {
  const text = typeof meta.chat_welcome_text === "string" ? meta.chat_welcome_text.trim() : "";
  const mediaPath =
    typeof meta.chat_welcome_media_path === "string" ? meta.chat_welcome_media_path.trim() : "";
  const rawType = meta.chat_welcome_media_type;
  const mediaType = rawType === "video" ? "video" : rawType === "image" ? "image" : null;
  return {
    text: text || null,
    mediaPath: mediaPath && mediaType ? mediaPath : null,
    mediaType: mediaPath && mediaType ? mediaType : null,
    blur: !!meta.chat_welcome_blur,
  };
}

/**
 * Post the creator's welcome message as the first message of a brand-new
 * chat, so what the fan saw on the locked chat screen is right there —
 * unblurred — once they're in. No-op when nothing is configured or the chat
 * already has messages. Never throws.
 */
export async function sendWelcomeMessage(
  chatId: string,
  ownerId: string,
  geo?: WelcomeGeo | null
) {
  try {
    const db = supabaseAdmin();
    const [{ data }, { count }] = await Promise.all([
      db.auth.admin.getUserById(ownerId),
      db.from("messages").select("id", { count: "exact", head: true }).eq("chat_id", chatId),
    ]);
    const welcome = welcomeFromMetadata(
      (data?.user?.user_metadata ?? {}) as Record<string, unknown>
    );
    if (!welcome.text && !welcome.mediaPath) return;
    if ((count ?? 0) > 0) return;

    const content = welcome.text
      ? geo
        ? applyUserGeoTokens(welcome.text, { ...geo, countryCode: null })
        : welcome.text
      : null;
    const { data: message } = await db
      .from("messages")
      .insert({
        chat_id: chatId,
        sender: "owner",
        content,
        media_path: welcome.mediaPath,
        media_type: welcome.mediaType,
      })
      .select("created_at")
      .single();
    if (message?.created_at) {
      await db
        .from("chats")
        .update({ last_message_at: message.created_at, last_read_at: message.created_at })
        .eq("id", chatId);
    }
  } catch (err) {
    console.error("sendWelcomeMessage failed:", err);
  }
}
