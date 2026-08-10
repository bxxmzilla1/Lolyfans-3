import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizeTelegramLink } from "@/lib/subscriptionPlan";

export const MAIN_TELEGRAM_KEY = "main_telegram_link";

/**
 * Site-wide main Telegram channel. Fans hitting lolyfans.com (and leftover
 * fan pages) are sent here. Invite links use their own redirect_url and never
 * read this value.
 */
export async function getMainTelegramLink(): Promise<string | null> {
  try {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("site_settings")
      .select("value")
      .eq("key", MAIN_TELEGRAM_KEY)
      .maybeSingle();

    if (!error && data?.value) {
      const link = normalizeTelegramLink(data.value);
      if (link) return link;
    }
  } catch {
    // Table missing before migration — fall through.
  }

  // Fallback until site_settings is migrated / saved from Settings.
  const fromEnv = normalizeTelegramLink(process.env.MAIN_TELEGRAM_CHANNEL_URL);
  if (fromEnv) return fromEnv;

  return null;
}

export async function setMainTelegramLink(raw: string): Promise<string> {
  const link = normalizeTelegramLink(raw);
  if (!link) throw new Error("Enter a valid Telegram invite link (t.me/…)");

  const db = supabaseAdmin();
  const { error } = await db.from("site_settings").upsert(
    {
      key: MAIN_TELEGRAM_KEY,
      value: link,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );
  if (error) throw new Error(error.message);
  return link;
}
