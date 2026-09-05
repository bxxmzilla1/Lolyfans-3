import { supabaseAdmin } from "./supabase/admin";

/** Key of the invite the bare domain ("/") redirects visitors to. */
export const HOME_REDIRECT_KEY = "home_redirect_invite_id";

/** Postgres "relation does not exist" — site_settings migration not run yet. */
export function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

export async function getSiteSetting(
  key: string
): Promise<{ value: string | null; needsMigration: boolean }> {
  const { data, error } = await supabaseAdmin()
    .from("site_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) return { value: null, needsMigration: isMissingTable(error) };
  return { value: data?.value ?? null, needsMigration: false };
}

/** Upserts the value; null clears it. Returns the DB error, if any. */
export async function setSiteSetting(key: string, value: string | null) {
  const { error } = await supabaseAdmin()
    .from("site_settings")
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  return error;
}

/**
 * Invite code the bare domain should redirect to, or null when the feature is
 * off, the table is missing, or the chosen link was deleted / disabled.
 */
export async function homeRedirectInviteCode(): Promise<string | null> {
  const { value } = await getSiteSetting(HOME_REDIRECT_KEY);
  if (!value) return null;
  const { data } = await supabaseAdmin()
    .from("invites")
    .select("code, active")
    .eq("id", value)
    .maybeSingle();
  return data?.active ? data.code : null;
}
