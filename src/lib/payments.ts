import { supabaseAdmin } from "@/lib/supabase/admin";
import { broadcast } from "@/lib/realtime";

/** Record that a fan unlocked a message (idempotent) and notify the chat. */
export async function recordUnlock(opts: {
  messageId: string;
  chatId: string;
  priceCents: number;
}) {
  const db = supabaseAdmin();
  await db.from("message_unlocks").upsert(
    {
      message_id: opts.messageId,
      chat_id: opts.chatId,
      price_cents: opts.priceCents,
    },
    { onConflict: "message_id,chat_id", ignoreDuplicates: true }
  );
  // Fan clients refresh on focus / unlock response; broadcast helps open tabs.
  await broadcast(`chat:${opts.chatId}`, "message-unlocked", {
    messageId: opts.messageId,
  });
}
