import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import {
  adsterraFetch,
  deleteAdsterraToken,
  getAdsterraToken,
  saveAdsterraToken,
} from "@/lib/adsterra";

/** Is an Adsterra API token saved for this creator? (Never returns the token.) */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = await getAdsterraToken(ownerId);
  return NextResponse.json({ configured: !!token });
}

/** Save the token after checking it actually works against the Adsterra API. */
export async function PUT(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  if (!token) {
    return NextResponse.json({ error: "Paste your API token" }, { status: 400 });
  }

  // Cheap validation call — domains.json responds 401/403 on a bad token.
  const check = await adsterraFetch(token, "domains.json").catch(() => null);
  if (!check) {
    return NextResponse.json(
      { error: "Could not reach Adsterra — try again" },
      { status: 502 }
    );
  }
  if (!check.ok) {
    return NextResponse.json(
      {
        error:
          check.status === 401 || check.status === 403
            ? "Adsterra rejected this token — generate a new one in Settings → API"
            : `Adsterra error (HTTP ${check.status})`,
      },
      { status: 400 }
    );
  }

  await saveAdsterraToken(ownerId, token);
  return NextResponse.json({ ok: true });
}

/** Disconnect: forget the saved token. */
export async function DELETE() {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await deleteAdsterraToken(ownerId);
  return NextResponse.json({ ok: true });
}
