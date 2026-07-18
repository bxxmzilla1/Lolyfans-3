import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId, getGuestChatId } from "@/lib/session";

/**
 * Returns a signed upload URL so the browser uploads media straight to
 * Supabase Storage (bypasses Vercel's request body size limit).
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  const guestChatId = await getGuestChatId();
  if (!ownerId && !guestChatId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileName, scope } = await req.json();
  const ext = String(fileName || "file").split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const folder =
    (scope === "vault" ||
      scope === "avatar" ||
      scope === "banner" ||
      scope === "post") &&
    ownerId
      ? scope
      : scope === "avatar" && guestChatId
      ? "avatar"
      : "chat";
  const path = `${folder}/${nanoid(16)}.${ext}`;

  const { data, error } = await supabaseAdmin()
    .storage.from("media")
    .createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Upload failed" }, { status: 500 });
  }
  return NextResponse.json({ path: data.path, token: data.token });
}
