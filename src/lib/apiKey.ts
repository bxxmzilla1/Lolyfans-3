import crypto from "crypto";
import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** A fresh, hard-to-guess API token shown to the owner once and stored in the db. */
export function generateApiToken(): string {
  return `loly_${crypto.randomBytes(24).toString("base64url")}`;
}

/**
 * Resolve the owner behind an API key sent by an external app (like Orion).
 * The token can arrive as `Authorization: Bearer <token>` or `x-api-key`.
 * Returns the owner's user id, or null when the key is missing/invalid.
 */
export async function ownerFromApiKey(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("authorization") || "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  const token = bearer || req.headers.get("x-api-key")?.trim() || "";
  if (!token) return null;

  const db = supabaseAdmin();
  const { data } = await db
    .from("api_keys")
    .select("owner_id")
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;

  // Best-effort "last used" stamp so the owner can see the key is active.
  db.from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token", token)
    .then(() => {});

  return data.owner_id as string;
}
