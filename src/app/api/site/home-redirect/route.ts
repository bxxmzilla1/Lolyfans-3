import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { listCreators } from "@/lib/creatorDirectory";
import {
  HOME_CREATOR_KEY,
  HOME_REDIRECT_KEY,
  getSiteSetting,
  isMissingTable,
  setSiteSetting,
} from "@/lib/siteSettings";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Current "Main page" choice — a creator's chat (`creatorId`), an invite
 * link (`inviteId`), or neither = off — plus the creators that can be picked.
 */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [invite, creator, creators] = await Promise.all([
    getSiteSetting(HOME_REDIRECT_KEY),
    getSiteSetting(HOME_CREATOR_KEY),
    listCreators(),
  ]);
  return NextResponse.json({
    inviteId: invite.value,
    creatorId: creator.value,
    needsMigration: invite.needsMigration || creator.needsMigration,
    creators,
  });
}

/**
 * Body: { creatorId } to show a creator's chat, { inviteId } (one of the
 * owner's links) to forward to an invite link, or neither / nulls = off.
 * The two options are exclusive: setting one clears the other.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const inviteId =
    typeof body.inviteId === "string" && body.inviteId.trim()
      ? body.inviteId.trim()
      : null;
  const creatorId =
    typeof body.creatorId === "string" && UUID_RE.test(body.creatorId.trim())
      ? body.creatorId.trim()
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
  if (creatorId) {
    const { data } = await supabaseAdmin().auth.admin.getUserById(creatorId);
    if (!data?.user) {
      return NextResponse.json({ error: "Creator not found" }, { status: 404 });
    }
  }

  // A creator pick wins over an invite pick if both were somehow sent.
  const finalCreator = creatorId;
  const finalInvite = creatorId ? null : inviteId;

  const errors = await Promise.all([
    setSiteSetting(HOME_CREATOR_KEY, finalCreator),
    setSiteSetting(HOME_REDIRECT_KEY, finalInvite),
  ]);
  const error = errors.find((e) => e) ?? null;
  if (isMissingTable(error)) {
    return NextResponse.json(
      { error: "Run migration-home-redirect.sql first", needsMigration: true },
      { status: 409 }
    );
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, inviteId: finalInvite, creatorId: finalCreator });
}
