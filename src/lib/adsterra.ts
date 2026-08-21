import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Adsterra Publishers API v3 (https://docs.adsterratools.com/public/v3/publishers-api).
 * The creator's API token (Adsterra → Settings → API → Generate token) is
 * stored per owner in site_settings; all calls go through our server so the
 * token never reaches the browser.
 */

export const ADSTERRA_API_BASE = "https://api3.adsterratools.com/publisher";

const TOKEN_KEY = (ownerId: string) => `adsterra_token:${ownerId}`;

export async function getAdsterraToken(ownerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("site_settings")
    .select("value")
    .eq("key", TOKEN_KEY(ownerId))
    .maybeSingle();
  return (data?.value || "").trim() || null;
}

export async function saveAdsterraToken(
  ownerId: string,
  token: string
): Promise<void> {
  await supabaseAdmin()
    .from("site_settings")
    .upsert(
      {
        key: TOKEN_KEY(ownerId),
        value: token.trim(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
}

export async function deleteAdsterraToken(ownerId: string): Promise<void> {
  await supabaseAdmin()
    .from("site_settings")
    .delete()
    .eq("key", TOKEN_KEY(ownerId));
}

/** GET an Adsterra endpoint (e.g. "stats.json?...") with the given token. */
export async function adsterraFetch(
  token: string,
  pathWithQuery: string
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${ADSTERRA_API_BASE}/${pathWithQuery}`, {
      headers: { Accept: "application/json", "X-API-Key": token },
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}
