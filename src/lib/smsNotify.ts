import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendSms } from "@/lib/twilio";

// A guest counts as online if their chat page heartbeated in the last 90s
// (the page pings every 45s while open).
const ONLINE_WINDOW_MS = 90_000;

// Minimum gap between SMS nudges to a guest who stays offline. Keeps a burst
// of messages (e.g. chatbot bubbles) down to one text, but still re-nudges
// them when new messages arrive later.
const RENOTIFY_AFTER_MS = 10 * 60_000;

/** The public URL of the app, from the request's proxy headers. */
export function requestOrigin(headers: Headers): string {
  const host = headers.get("x-forwarded-host") || headers.get("host") || "";
  if (!host) return "";
  const proto = headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

/**
 * Text the guest that the creator messaged them — but only when they're
 * offline, and at most once per 10 minutes (so a burst of chat bubbles or
 * rapid-fire messages don't turn into an SMS flood). Coming back online
 * resets the timer, so the next offline message nudges them right away.
 */
export async function notifyGuestSms(chatId: string, origin: string): Promise<void> {
  try {
    const db = supabaseAdmin();
    const { data: chat } = await db
      .from("chats")
      .select("id, owner_id, guest_phone, guest_last_seen_at, sms_notified_at")
      .eq("id", chatId)
      .maybeSingle();
    if (!chat?.guest_phone) return;

    const lastSeen = chat.guest_last_seen_at ? Date.parse(chat.guest_last_seen_at) : 0;
    if (Date.now() - lastSeen < ONLINE_WINDOW_MS) return; // online — no SMS

    // Skip only if we already texted them recently and they haven't been
    // back since — later messages re-nudge after the cooldown.
    const notified = chat.sms_notified_at ? Date.parse(chat.sms_notified_at) : 0;
    const seenSinceLastSms = lastSeen > notified;
    if (notified && !seenSinceLastSms && Date.now() - notified < RENOTIFY_AFTER_MS) {
      return;
    }

    // Claim the notification atomically (only one claim wins when several
    // messages land at once, e.g. Orion sending separate bubbles).
    let claim = db
      .from("chats")
      .update({ sms_notified_at: new Date().toISOString() })
      .eq("id", chat.id);
    claim = chat.sms_notified_at
      ? claim.eq("sms_notified_at", chat.sms_notified_at)
      : claim.is("sms_notified_at", null);
    const { data: claimed } = await claim.select("id");
    if (!claimed?.length) return;

    const { data: ownerUser } = await db.auth.admin.getUserById(chat.owner_id);
    const meta = (ownerUser?.user?.user_metadata ?? {}) as { display_name?: string };
    const name = meta.display_name || "Someone";

    await sendSms(
      chat.guest_phone,
      `${name} sent you a message on Lolyfans. Reply to her here ${origin}`
    );
  } catch (err) {
    console.error("Offline SMS notify failed:", err);
  }
}
