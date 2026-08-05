import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { appOrigin, ensureCpmLink } from "@/lib/cpm";
import { tgSendText, tgSessionFor } from "@/lib/telegram";

export const runtime = "nodejs";

/** Escape user text for Telegram HTML parse mode. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Send the creator's Chat-per-minute link into their own Saved Messages as
 * clickable words (HTML link) instead of a raw URL, so it can be copied and
 * pasted into DMs or channels looking clean. Tapping it opens Telegram's
 * in-app browser on the payment page.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await tgSessionFor(ownerId);
  if (!session) {
    return NextResponse.json(
      { error: "Connect your Telegram account first" },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const label =
    String(body.text || "").trim().slice(0, 80) || "Chat with me privately 💬";

  try {
    const code = await ensureCpmLink(ownerId);
    const url = `${appOrigin()}/m/${code}`;
    await tgSendText({
      session,
      peer: "me",
      text: `<a href="${url}">${esc(label)}</a>`,
      html: true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not send";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
