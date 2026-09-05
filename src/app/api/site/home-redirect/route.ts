import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import {
  HOME_REDIRECT_KEY,
  getSiteSetting,
  isMissingTable,
  setSiteSetting,
} from "@/lib/siteSettings";

/** Current "Main Page Redirect" choice: the invite id, or null when off. */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { value, needsMigration } = await getSiteSetting(HOME_REDIRECT_KEY);
  return NextResponse.json({ inviteId: value, needsMigration });
}

/** Body: { inviteId: string | null } — one of the owner's links, or null = off. */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const inviteId =
    typeof body.inviteId === "string" && body.inviteId.trim()
      ? body.inviteId.trim()
      : null;

  if (inviteId) {
    // Only the owner's own links can become the home redirect.
    const { data: invite } = await supabaseAdmin()
      .from("invites")
      .select("id")
      .eq("id", inviteId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (!invite) {
      return NextResponse.json({ error: "Invite link not found" }, { status: 404 });
    }
  }

  const error = await setSiteSetting(HOME_REDIRECT_KEY, inviteId);
  if (isMissingTable(error)) {
    return NextResponse.json(
      { error: "Run migration-home-redirect.sql first", needsMigration: true },
      { status: 409 }
    );
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, inviteId });
}
