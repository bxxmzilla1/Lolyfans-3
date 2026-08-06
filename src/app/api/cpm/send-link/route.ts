import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { appOrigin, ensureCpmLink } from "@/lib/cpm";
import { tgSendText, tgSessionFor } from "@/lib/telegram";

export const runtime = "nodejs";

/** Escape user text for Telegram HTML parse mode. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A usable http(s) URL, or null. Bare domains get https:// prepended. */
function normalizeUrl(raw: string): string | null {
  const s = raw.trim().slice(0, 500);
  if (!s) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Send a link into the creator's own Saved Messages as clickable words
 * (HTML link) instead of a raw URL, so it can be copied and pasted into DMs
 * or channels looking clean. Defaults to the Chat-per-minute link; a custom
 * `url` in the body turns any link into shareable clickable text.
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
  const customUrl =
    typeof body.url === "string" ? normalizeUrl(body.url) : null;
  if (typeof body.url === "string" && body.url.trim() && !customUrl) {
    return NextResponse.json(
      { error: "That link doesn't look valid — use a full http(s) URL" },
      { status: 400 }
    );
  }

  try {
    let url = customUrl;
    if (!url) {
      const code = await ensureCpmLink(ownerId);
      url = `${appOrigin()}/m/${code}`;
    }
    await tgSendText({
      session,
      peer: "me",
      text: `<a href="${url}"><b>${esc(label)}</b></a>`,
      html: true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not send";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
