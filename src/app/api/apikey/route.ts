import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { generateApiToken } from "@/lib/apiKey";

/** Return the owner's current API key (or null if they haven't made one). */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabaseAdmin()
    .from("api_keys")
    .select("token, created_at, last_used_at")
    .eq("owner_id", ownerId)
    .maybeSingle();

  return NextResponse.json({ key: data ?? null });
}

/** Generate (or regenerate) the owner's API key, replacing any existing one. */
export async function POST() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = generateApiToken();
  const { data, error } = await supabaseAdmin()
    .from("api_keys")
    .upsert(
      { owner_id: ownerId, token, created_at: new Date().toISOString(), last_used_at: null },
      { onConflict: "owner_id" }
    )
    .select("token, created_at, last_used_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ key: data });
}

/** Revoke the owner's API key so external apps lose access. */
export async function DELETE() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabaseAdmin()
    .from("api_keys")
    .delete()
    .eq("owner_id", ownerId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
