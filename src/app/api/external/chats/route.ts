import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ownerFromApiKey } from "@/lib/apiKey";
import { requestOrigin } from "@/lib/smsNotify";
import {
  telegramConfigured,
  tgListDialogs,
  tgGetMessages,
  tgSessionFor,
  type TgDialog,
  type TgMessage,
} from "@/lib/telegram";

// Telegram reads (userbot connect + getMessages) can be slow on big dialogs —
// allow up to 60s so a deep fetch never dies mid-page.
export const maxDuration = 60;

// Allow the Orion desktop app (or any external client) to call this.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Orion talks to the platform in a fixed chat/message shape (role "me"/"fan",
 * media {kind,url,path}, locked/priceTokens/unlocked). Chats now live in the
 * creator's Telegram account, so this endpoint maps Telegram dialogs/messages
 * into that same shape — Orion's pipeline is unchanged, only the source moved.
 *
 * A "chat id" is now the Telegram peer key ("user:<id>:<hash>"). Media has no
 * public URL, so each media message points at /api/external/telegram-media,
 * which streams the bytes (API key rides in ?key= so a bare fetch works).
 */

type OrionMessage = {
  id: string;
  role: "me" | "fan";
  content: string;
  at: string;
  media: { kind: "image" | "video" | "audio"; url: string; path: string } | null;
  mediaItems: never[];
  locked: boolean;
  priceTokens: number;
  unlocked: boolean;
};

function isoFromEpochSeconds(sec: number): string {
  const ms = (Number(sec) || 0) * 1000;
  return ms > 0 ? new Date(ms).toISOString() : new Date(0).toISOString();
}

function mediaKindForOrion(
  k: TgMessage["mediaKind"]
): "image" | "video" | "audio" | null {
  if (k === "image") return "image";
  if (k === "video" || k === "gif") return "video";
  if (k === "voice") return "audio";
  // stickers / other: nothing useful for the bot to "see", skip.
  return null;
}

function mediaUrlFor(
  origin: string,
  apiKey: string,
  peer: string,
  id: number
): string {
  const q = new URLSearchParams({ peer, id: String(id), key: apiKey });
  // Absolute URL: Orion fetches media.url directly (frame extraction, UI),
  // not through its base-prepending request helper.
  return `${origin}/api/external/telegram-media?${q.toString()}`;
}

function shapeTgMessage(
  m: TgMessage & { ppv?: "paid" | "pending" | null },
  origin: string,
  apiKey: string,
  peer: string
): OrionMessage {
  const kind = m.hasMedia ? mediaKindForOrion(m.mediaKind) : null;
  return {
    id: String(m.id),
    role: m.out ? "me" : "fan",
    content: m.text || "",
    at: isoFromEpochSeconds(m.date),
    media: kind
      ? { kind, url: mediaUrlFor(origin, apiKey, peer, m.id), path: "" }
      : null,
    mediaItems: [],
    // A priced teaser we sent is "locked"; only a paid one counts as unlocked.
    locked: !!m.ppv,
    priceTokens: 0,
    unlocked: m.ppv === "paid",
  };
}

/** Only fans (DMs). The bot never auto-replies in groups or channels. */
function dmDialogs(dialogs: TgDialog[]): TgDialog[] {
  return dialogs.filter((d) => d.kind === "user");
}

/** PPV state per outgoing teaser message id, so paid drops read as unlocked. */
async function ppvStatusByMessageId(
  ownerId: string,
  peer: string,
  messageIds: number[]
): Promise<Map<number, "paid" | "pending">> {
  const map = new Map<number, "paid" | "pending">();
  if (!messageIds.length) return map;
  const { data } = await supabaseAdmin()
    .from("telegram_unlocks")
    .select("tg_message_id, tg_peer, status, delivered_at")
    .eq("owner_id", ownerId)
    .in("tg_message_id", messageIds);
  for (const row of data ?? []) {
    if (row.tg_peer !== peer) continue;
    const id = Number(row.tg_message_id);
    if (!Number.isFinite(id)) continue;
    map.set(
      id,
      row.status === "paid" || row.status === "delivering" || row.delivered_at
        ? "paid"
        : "pending"
    );
  }
  return map;
}

/** Deep fetch: full recent transcript for one peer, mapped to Orion shape. */
async function deepFetch(
  session: string,
  ownerId: string,
  origin: string,
  apiKey: string,
  peer: string,
  limit: number
): Promise<OrionMessage[]> {
  const messages = await tgGetMessages({ session, peer, limit });
  const ppv = await ppvStatusByMessageId(
    ownerId,
    peer,
    messages.filter((m) => m.out).map((m) => m.id)
  ).catch(() => new Map<number, "paid" | "pending">());
  return messages.map((m) =>
    shapeTgMessage(
      { ...m, ppv: (m.out && ppv.get(m.id)) || null },
      origin,
      apiKey,
      peer
    )
  );
}

export async function GET(req: NextRequest) {
  const ownerId = await ownerFromApiKey(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS });
  }

  // The raw token, so media URLs can be fetched without a header.
  const apiKey =
    (req.headers.get("authorization") || "").toLowerCase().startsWith("bearer ")
      ? (req.headers.get("authorization") || "").slice(7).trim()
      : req.headers.get("x-api-key")?.trim() ||
        req.nextUrl.searchParams.get("key")?.trim() ||
        "";

  if (!telegramConfigured()) {
    return NextResponse.json(
      { error: "Telegram is not configured on the server" },
      { status: 503, headers: CORS }
    );
  }
  const session = await tgSessionFor(ownerId);
  if (!session) {
    return NextResponse.json(
      { error: "Connect your Telegram account first (Settings → Telegram)" },
      { status: 400, headers: CORS }
    );
  }

  const origin = requestOrigin(req.headers) || req.nextUrl.origin;
  const peer = req.nextUrl.searchParams.get("chatId");
  const limitParam = Math.floor(Number(req.nextUrl.searchParams.get("limit") || 0));
  const msgLimit = limitParam > 0 ? Math.min(500, Math.max(10, limitParam)) : 0;

  // Single-chat deep fetch (an opened conversation / drafting a reply).
  if (peer) {
    try {
      const msgs = await deepFetch(
        session,
        ownerId,
        origin,
        apiKey,
        peer,
        msgLimit || 200
      );
      const last = msgs[msgs.length - 1];
      return NextResponse.json(
        {
          chat: {
            id: peer,
            name: "",
            username: "",
            country: "",
            lastMessage: last?.content || "",
            lastMessageAt: last?.at || null,
            botRepliedAt: last?.role === "me" ? last.at : null,
            messages: msgs,
          },
        },
        { headers: CORS }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load messages";
      return NextResponse.json({ error: message }, { status: 500, headers: CORS });
    }
  }

  // List: every DM, newest first. Messages aren't embedded (one Telegram
  // fetch per dialog would be slow and hit rate limits) — instead each chat
  // carries a single synthesized "last message" built from the dialog preview,
  // which is all Orion's need-detection (reply-needed / silent) requires. It
  // deep-fetches the full transcript per chat before drafting.
  let dialogs: TgDialog[];
  try {
    dialogs = dmDialogs(await tgListDialogs({ session, limit: 200 }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load chats";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS });
  }

  const chats = dialogs.map((d) => {
    const at = isoFromEpochSeconds(d.date);
    // The preview is the newest message; role tells Orion whether the fan is
    // waiting (incoming) or we spoke last (outgoing → nothing to answer).
    const lastMsg: OrionMessage | null = d.preview
      ? {
          id: `preview:${d.peer}:${d.date}`,
          role: d.lastOut ? "me" : "fan",
          content: d.preview,
          at,
          media: null,
          mediaItems: [],
          locked: false,
          priceTokens: 0,
          unlocked: false,
        }
      : null;
    return {
      id: d.peer,
      name: d.title,
      username: d.username || "",
      country: "",
      lastMessage: d.preview,
      lastMessageAt: at,
      // If we spoke last there's nothing to answer; mark bot-replied so the
      // auto-responder leaves it alone until the fan writes back.
      botRepliedAt: d.lastOut ? at : null,
      unread: d.unread,
      messages: lastMsg ? [lastMsg] : [],
    };
  });

  return NextResponse.json({ chats }, { headers: CORS });
}
