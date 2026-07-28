import { supabaseAdmin } from "@/lib/supabase/admin";
import { broadcast } from "@/lib/realtime";
import { elevenLabsTts, personalizeScript } from "@/lib/elevenlabs";

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
    welcome_media_locked?: boolean;
    welcome_media_price_cents?: number;
    /** Legacy (token era): 1 token = 10¢. */
    welcome_media_price_tokens?: number;
    welcome_voice_path?: string;
    welcome_voice_mode?: string;
    welcome_voice_text?: string;
    welcome_voice_id?: string;
    elevenlabs_api_key?: string;
  };
  if (!meta.welcome_enabled) return;
  const text = (meta.welcome_text || "").trim();
  const mediaPath = meta.welcome_media_path || null;
  let voicePath = meta.welcome_voice_path || null;

  // AI voice mode: synthesize a voice note unique to this fan (their first
  // name spliced into the script) with ElevenLabs' v3 model. Any failure
  // falls back to the uploaded voice note (if one exists) so the welcome
  // still goes out.
  const voiceScript = (meta.welcome_voice_text || "").trim();
  const ttsReady =
    meta.welcome_voice_mode === "tts" &&
    !!voiceScript &&
    !!meta.welcome_voice_id &&
    !!meta.elevenlabs_api_key;
  if (meta.welcome_voice_mode === "tts" && !ttsReady) voicePath = null;
  if (ttsReady) {
    voicePath = null;
    try {
      const { data: chat } = await db
        .from("chats")
        .select("guest_name")
        .eq("id", chatId)
        .single();
      const spoken = personalizeScript(voiceScript, chat?.guest_name || "");
      if (spoken) {
        const audio = await elevenLabsTts(
          meta.elevenlabs_api_key!,
          meta.welcome_voice_id!,
          spoken
        );
        const path = `welcome-voice/${chatId}/${Date.now()}.mp3`;
        const { error: upErr } = await db.storage
          .from("media")
          .upload(path, audio, {
            contentType: "audio/mpeg",
            cacheControl: "31536000",
          });
        if (!upErr) voicePath = path;
        else console.error("Welcome voice upload failed:", upErr.message);
      }
    } catch (e) {
      console.error(
        "Welcome voice generation failed:",
        e instanceof Error ? e.message : e
      );
      voicePath = meta.welcome_voice_path || null;
    }
  }

  if (!text && !mediaPath && !voicePath) return;

  // Creator can price the welcome media: it arrives blurred + pay-to-unlock,
  // exactly like locked content sent from the chat composer. Prices set in
  // the token era (tokens × 10¢) still resolve to the same dollar amount.
  const priceCents =
    Math.round(Number(meta.welcome_media_price_cents)) ||
    (Math.round(Number(meta.welcome_media_price_tokens)) || 0) * 10;
  const locked = !!mediaPath && !!meta.welcome_media_locked && priceCents > 0;

  // Up to two bubbles: the text/media message, then the voice note — so the
  // voice can stand in for a written caption while media rides along.
  const inserts: {
    chat_id: string;
    sender: "owner";
    content: string | null;
    media_path: string | null;
    media_type: "image" | "video" | "audio" | null;
    locked: boolean;
    price_cents: number;
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
      locked,
      price_cents: locked ? priceCents : 0,
    });
  }
  // The voice note bubble is never locked — it's the greeting itself.
  if (voicePath) {
    inserts.push({
      chat_id: chatId,
      sender: "owner",
      content: null,
      media_path: voicePath,
      media_type: "audio",
      locked: false,
      price_cents: 0,
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
