import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * invite_events: the full, timestamped log of invite-link activity — every
 * click (revisits included) and every signup. Unlike invite_visits (unique
 * per IP, drives the "clicks" stat), nothing here is collapsed.
 */

/**
 * Same visitor hitting the landing page and then the profile page (or being
 * redirected between them) is ONE click, so clicks from the same IP within
 * this window are not logged twice.
 */
const CLICK_DEDUPE_MS = 30_000;

export async function recordInviteEvent(event: {
  inviteId: string;
  kind: "click" | "signup";
  chatId?: string | null;
  ip?: string | null;
  country?: string | null;
}) {
  const db = supabaseAdmin();
  try {
    if (event.kind === "click" && event.ip) {
      const { data: recent } = await db
        .from("invite_events")
        .select("created_at")
        .eq("invite_id", event.inviteId)
        .eq("kind", "click")
        .eq("ip", event.ip)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (
        recent &&
        Date.now() - new Date(recent.created_at).getTime() < CLICK_DEDUPE_MS
      ) {
        return;
      }
    }

    const { error } = await db.from("invite_events").insert({
      invite_id: event.inviteId,
      kind: event.kind,
      chat_id: event.chatId ?? null,
      ip: event.ip ?? null,
      country: event.country ?? null,
    });
    if (error) console.error("invite_events insert failed:", error.message);
  } catch (e) {
    // Logging must never break the page/signup (e.g. table not migrated yet).
    console.error("invite_events failed:", e instanceof Error ? e.message : e);
  }
}
