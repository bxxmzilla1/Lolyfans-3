import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mediaUrl } from "@/lib/utils";
// Static import so the pre-rendered badge pixels are always part of the
// serverless bundle (a failed dynamic import would silently drop them).
import { GLYPHS, GLYPH_CANVAS_H } from "@/lib/badgeAssets";

/**
 * Creator's own Telegram account (MTProto / GramJS "userbot"). The creator
 * logs in once from Settings; the StringSession is stored server-side and
 * reused to send locked media into a fan's DM and to deliver the clear file
 * after the fan pays on the unlock page.
 *
 * NOTE: automating a personal account is against Telegram's ToS and can get
 * the account limited — this is the same trade-off PayAndView-style tools
 * accept. Kept deliberately low-volume (one DM per manual send).
 */

// GramJS is a heavy, CJS-ish native-ish package; import lazily so it never
// ends up in the edge/client bundle and only loads when actually used.
type AnyClient = {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  invoke: (req: unknown) => Promise<unknown>;
  sendFile: (peer: unknown, opts: Record<string, unknown>) => Promise<unknown>;
  sendMessage: (peer: unknown, opts: Record<string, unknown>) => Promise<unknown>;
  getDialogs: (opts?: Record<string, unknown>) => Promise<unknown[]>;
  getMessages: (
    peer: unknown,
    opts?: Record<string, unknown>
  ) => Promise<unknown[]>;
  downloadMedia: (
    message: unknown,
    opts?: Record<string, unknown>
  ) => Promise<Buffer | string | null>;
  getInputEntity: (peer: unknown) => Promise<unknown>;
  downloadProfilePhoto: (
    entity: unknown,
    opts?: Record<string, unknown>
  ) => Promise<Buffer | string | undefined | null>;
  getMe: () => Promise<{ username?: string; phone?: string }>;
  session: { save: () => string };
};

/** Stable peer key used in the inbox URL and send APIs. */
export type TgPeerKey =
  | `@${string}`
  | `user:${string}:${string}`
  | `channel:${string}:${string}`
  | `chat:${string}`;

/** Outgoing delivery state: sent to Telegram, or read by the peer. */
export type TgReceipt = "sent" | "read";

export type TgDialog = {
  peer: string;
  title: string;
  username: string | null;
  kind: "user" | "group" | "channel";
  unread: number;
  preview: string;
  date: number;
  photoUrl: string | null;
  /** True when the preview message was sent by us. */
  lastOut: boolean;
  lastReceipt: TgReceipt | null;
  /** Pinned in Telegram — kept at the top of the inbox list. */
  pinned: boolean;
};

export type TgMessage = {
  id: number;
  text: string;
  out: boolean;
  date: number;
  hasMedia: boolean;
  /** "gif" = animated (GIFs + video stickers, autoplay loop); "sticker" = static sticker. */
  mediaKind: "image" | "video" | "gif" | "sticker" | "other" | null;
  /** Outgoing only: single check = sent, double = read. */
  receipt: TgReceipt | null;
};

function apiCreds(): { apiId: number; apiHash: string } {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH || "";
  if (!apiId || !apiHash) {
    throw new Error(
      "Telegram is not configured — set TELEGRAM_API_ID and TELEGRAM_API_HASH"
    );
  }
  return { apiId, apiHash };
}

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_API_ID && !!process.env.TELEGRAM_API_HASH;
}

async function gramjs() {
  // Import only the main entry (it re-exports `sessions` and `password`), so
  // the externalized package resolves cleanly under Node at runtime.
  const tg = await import("telegram");
  return {
    Api: tg.Api,
    TelegramClient: tg.TelegramClient,
    StringSession: tg.sessions.StringSession,
    computeCheck: tg.password.computeCheck,
    CustomFile: tg.client.uploads.CustomFile,
    strippedPhotoToJpg: tg.utils.strippedPhotoToJpg,
  };
}

/** Build + connect a client for the given (possibly empty) session string. */
async function connect(session: string): Promise<AnyClient> {
  const { TelegramClient, StringSession } = await gramjs();
  const { apiId, apiHash } = apiCreds();
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 3,
    useWSS: true,
  }) as unknown as AnyClient;
  await client.connect();
  return client;
}

// ---------------------------------------------------------------------------
// Login flow (3 steps: send code → sign in with code → optional 2FA password)
// ---------------------------------------------------------------------------

/** Step 1: send the login code to the creator's phone. */
export async function tgSendCode(phone: string): Promise<{
  session: string;
  phoneCodeHash: string;
}> {
  const { Api } = await gramjs();
  const { apiId, apiHash } = apiCreds();
  const client = await connect("");
  try {
    const res = (await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({}),
      })
    )) as { phoneCodeHash: string };
    return { session: client.session.save(), phoneCodeHash: res.phoneCodeHash };
  } finally {
    await client.disconnect().catch(() => {});
  }
}

type SignInResult =
  | { status: "connected"; session: string; username: string | null; phone: string | null }
  | { status: "password_needed"; session: string };

/** Step 2: sign in with the SMS/app code. May report that 2FA is required. */
export async function tgSignIn(opts: {
  session: string;
  phone: string;
  phoneCodeHash: string;
  code: string;
}): Promise<SignInResult> {
  const { Api } = await gramjs();
  const client = await connect(opts.session);
  try {
    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: opts.phone,
          phoneCodeHash: opts.phoneCodeHash,
          phoneCode: opts.code,
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("SESSION_PASSWORD_NEEDED")) {
        return { status: "password_needed", session: client.session.save() };
      }
      throw err;
    }
    const me = await client.getMe();
    return {
      status: "connected",
      session: client.session.save(),
      username: me.username ?? null,
      phone: me.phone ?? null,
    };
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** Step 3 (only when 2FA is on): finish sign-in with the account password. */
export async function tgSignInPassword(opts: {
  session: string;
  password: string;
}): Promise<{ session: string; username: string | null; phone: string | null }> {
  const { Api, computeCheck } = await gramjs();
  const client = await connect(opts.session);
  try {
    const pwd = await client.invoke(new Api.account.GetPassword());
    const check = await computeCheck(pwd as never, opts.password);
    await client.invoke(new Api.auth.CheckPassword({ password: check as never }));
    const me = await client.getMe();
    return {
      session: client.session.save(),
      username: me.username ?? null,
      phone: me.phone ?? null,
    };
  } finally {
    await client.disconnect().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Fetch a stored media file into a Buffer (from the public media bucket). */
async function downloadMedia(path: string): Promise<Buffer> {
  const res = await fetch(mediaUrl(path));
  if (!res.ok) throw new Error("Could not read the media file");
  return Buffer.from(await res.arrayBuffer());
}

/** Resolve the connected session string for a creator, or null. */
export async function tgSessionFor(ownerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("telegram_accounts")
    .select("session, status")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!data || data.status !== "connected" || !data.session) return null;
  return data.session as string;
}

/**
 * Turn a peer key (@user / phone / user:id:hash / channel:id:hash) into a
 * value GramJS sendMessage / sendFile accepts.
 */
async function resolvePeer(peer: string): Promise<unknown> {
  const p = peer.trim();
  if (!p) throw new Error("Missing Telegram peer");

  if (p.startsWith("user:")) {
    const [, id, accessHash] = p.split(":");
    const { Api } = await gramjs();
    return new Api.InputPeerUser({
      userId: bigInt(id),
      accessHash: bigInt(accessHash || "0"),
    });
  }
  if (p.startsWith("channel:")) {
    const [, id, accessHash] = p.split(":");
    const { Api } = await gramjs();
    return new Api.InputPeerChannel({
      channelId: bigInt(id),
      accessHash: bigInt(accessHash || "0"),
    });
  }
  if (p.startsWith("chat:")) {
    const [, id] = p.split(":");
    const { Api } = await gramjs();
    return new Api.InputPeerChat({ chatId: bigInt(id) });
  }

  // @username, bare username, or phone — GramJS resolves these as strings.
  if (!p.startsWith("@") && !/^\+?\d{6,15}$/.test(p)) return `@${p}`;
  return p;
}

/** GramJS TL types expect big-integer's BigInteger, not native bigint. */
function bigInt(value: string): // eslint-disable-next-line @typescript-eslint/no-explicit-any
any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("big-integer")(value);
}

function entityPeerKey(entity: {
  className?: string;
  id?: unknown;
  accessHash?: unknown;
  username?: string;
}): string {
  const username = entity.username ? String(entity.username) : "";
  if (username) return `@${username}`;
  const id = String(entity.id ?? "");
  const hash = String(entity.accessHash ?? "0");
  const cls = entity.className || "";
  if (cls.includes("Channel")) return `channel:${id}:${hash}`;
  if (cls.includes("Chat") && !cls.includes("User")) return `chat:${id}`;
  return `user:${id}:${hash}`;
}

function entityKind(entity: { className?: string; broadcast?: boolean; megagroup?: boolean }): TgDialog["kind"] {
  const cls = entity.className || "";
  if (cls.includes("User")) return "user";
  if (cls.includes("Channel") && entity.broadcast && !entity.megagroup) return "channel";
  return "group";
}

function messagePreview(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const m = msg as { message?: string; media?: unknown };
  if (typeof m.message === "string" && m.message.trim()) {
    return m.message.trim().slice(0, 120);
  }
  if (m.media) return "📎 Media";
  return "";
}

function asMsgId(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "value" in value) {
    return Number((value as { value: unknown }).value);
  }
  return Number(value) || 0;
}

function receiptForOutgoing(
  messageId: number,
  readOutboxMaxId: number
): TgReceipt {
  return messageId > 0 && messageId <= readOutboxMaxId ? "read" : "sent";
}

/** List recent Telegram dialogs (DMs, groups, channels) for the connected account. */
export async function tgListDialogs(opts: {
  session: string;
  limit?: number;
}): Promise<TgDialog[]> {
  const client = await connect(opts.session);
  try {
    const { strippedPhotoToJpg } = await gramjs();
    const dialogs = (await client.getDialogs({
      limit: opts.limit ?? 80,
    })) as Array<{
      title?: string;
      unreadCount?: number;
      date?: number;
      archived?: boolean;
      pinned?: boolean;
      folderId?: number;
      isUser?: boolean;
      isGroup?: boolean;
      isChannel?: boolean;
      entity?: {
        className?: string;
        id?: unknown;
        accessHash?: unknown;
        username?: string;
        broadcast?: boolean;
        megagroup?: boolean;
        photo?: { strippedThumb?: unknown };
      };
      message?: { id?: unknown; out?: boolean; message?: string; media?: unknown };
      dialog?: { readOutboxMaxId?: unknown };
    }>;

    return dialogs
      // Archived chats stay out of the inbox — archive on Telegram or via
      // the in-app button to hide someone.
      .filter((d) => d.entity && !d.archived && d.folderId !== 1)
      .map((d) => {
        const entity = d.entity!;
        const msg = d.message;
        const lastOut = !!msg?.out;
        const msgId = asMsgId(msg?.id);
        const readOut = asMsgId(d.dialog?.readOutboxMaxId);

        // Tiny (~40px) profile photo baked into the entity — free to ship
        // and small enough to never hurt list performance.
        let photoUrl: string | null = null;
        const stripped = entity.photo?.strippedThumb;
        if (stripped) {
          try {
            const jpg = strippedPhotoToJpg(stripped as Buffer) as Buffer;
            photoUrl = `data:image/jpeg;base64,${Buffer.from(jpg).toString("base64")}`;
          } catch {
            photoUrl = null;
          }
        }

        return {
          peer: entityPeerKey(entity),
          title: d.title || entity.username || "Telegram",
          username: entity.username ? String(entity.username) : null,
          kind: entityKind(entity),
          unread: d.unreadCount ?? 0,
          preview: messagePreview(d.message),
          date: typeof d.date === "number" ? d.date : 0,
          photoUrl,
          lastOut,
          lastReceipt: lastOut ? receiptForOutgoing(msgId, readOut) : null,
          pinned: !!d.pinned,
        };
      });
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** Clear small profile photo for one dialog (webp, ~128px). */
export async function tgDownloadProfilePhoto(opts: {
  session: string;
  peer: string;
}): Promise<Buffer | null> {
  const client = await connect(opts.session);
  try {
    const resolved = await resolvePeer(opts.peer);
    const entity = await client.getInputEntity(resolved);
    const raw = await client.downloadProfilePhoto(entity, { isBig: false });
    if (!raw) return null;
    const buf = Buffer.isBuffer(raw)
      ? raw
      : typeof raw === "string"
        ? await (await import("fs/promises")).readFile(raw)
        : null;
    if (!buf?.length) return null;
    const sharp = (await import("sharp")).default;
    return await sharp(buf)
      .resize(128, 128, { fit: "cover" })
      .webp({ quality: 70 })
      .toBuffer();
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** Pin (or unpin) a dialog — mirrors pinning it in the Telegram app. */
export async function tgSetPinned(opts: {
  session: string;
  peer: string;
  pinned: boolean;
}): Promise<void> {
  const client = await connect(opts.session);
  try {
    const { Api } = await gramjs();
    const resolved = await resolvePeer(opts.peer);
    const input = await client.getInputEntity(resolved);
    await client.invoke(
      new Api.messages.ToggleDialogPin({
        peer: new Api.InputDialogPeer({ peer: input as never }),
        pinned: opts.pinned,
      })
    );
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** Move a dialog into (or out of) Telegram's archive folder. */
export async function tgSetArchived(opts: {
  session: string;
  peer: string;
  archived: boolean;
}): Promise<void> {
  const client = await connect(opts.session);
  try {
    const { Api } = await gramjs();
    const resolved = await resolvePeer(opts.peer);
    const input = await client.getInputEntity(resolved);
    await client.invoke(
      new Api.folders.EditPeerFolders({
        folderPeers: [
          new Api.InputFolderPeer({
            peer: input as never,
            folderId: opts.archived ? 1 : 0,
          }),
        ],
      })
    );
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** Mime type of a message's document media ("" when not a document). */
function docMimeOf(media: unknown): string {
  const doc = (media as { document?: { mimeType?: string } } | null)?.document;
  return String(doc?.mimeType || "");
}

function mediaKindOf(media: unknown): TgMessage["mediaKind"] {
  if (!media || typeof media !== "object") return null;
  const cls = String((media as { className?: string }).className || "");
  if (cls.includes("MessageMediaPhoto") || cls.includes("Photo")) return "image";
  if (cls.includes("MessageMediaDocument") || cls.includes("Document")) {
    const doc = (media as { document?: { mimeType?: string; attributes?: Array<{ className?: string }> } })
      .document;
    const mime = String(doc?.mimeType || "");
    const attrs = (doc?.attributes ?? []).map((a) => String(a.className || ""));
    // Stickers first — video stickers (webm) would otherwise match "video/".
    if (mime === "application/x-tgsticker" || attrs.some((a) => a.includes("Sticker"))) {
      return mime.startsWith("video/") ? "gif" : "sticker";
    }
    // Telegram "GIFs" are mp4 documents flagged animated.
    if (attrs.some((a) => a.includes("Animated"))) return "gif";
    // A real .gif file animates fine in an <img>, so treat it as an image.
    if (mime === "image/gif") return "image";
    if (mime.startsWith("video/") || attrs.some((a) => a.includes("Video"))) {
      return "video";
    }
    if (mime.startsWith("image/")) return "image";
    return "other";
  }
  return "other";
}

/** Best-effort mime sniff for downloaded thumbs (webp stickers vs jpeg). */
function sniffImageMime(data: Buffer): string {
  if (data.length > 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (data.length > 4 && data[0] === 0x89 && data[1] === 0x50) return "image/png";
  return "image/jpeg";
}

/** Peer’s read-outbox watermark (highest outgoing message id they’ve opened). */
async function fetchReadOutboxMaxId(
  client: AnyClient,
  peer: unknown
): Promise<number> {
  try {
    const { Api } = await gramjs();
    const res = (await client.invoke(
      new Api.messages.GetPeerDialogs({
        peers: [new Api.InputDialogPeer({ peer: peer as never })],
      })
    )) as { dialogs?: Array<{ readOutboxMaxId?: unknown }> };
    return asMsgId(res.dialogs?.[0]?.readOutboxMaxId);
  } catch {
    return 0;
  }
}

/** Recent messages in one Telegram dialog. */
export async function tgGetMessages(opts: {
  session: string;
  peer: string;
  limit?: number;
}): Promise<TgMessage[]> {
  const client = await connect(opts.session);
  try {
    const peer = await resolvePeer(opts.peer);
    const [messages, readOutboxMaxId] = await Promise.all([
      client.getMessages(peer, {
        limit: opts.limit ?? 40,
      }) as Promise<
        Array<{
          id?: number;
          message?: string;
          out?: boolean;
          date?: number;
          media?: unknown;
        }>
      >,
      fetchReadOutboxMaxId(client, peer),
    ]);

    // Clear our unread badge for this chat (mirrors opening it in Telegram).
    try {
      const { Api } = await gramjs();
      await client.invoke(
        new Api.messages.ReadHistory({ peer: peer as never, maxId: 0 })
      );
    } catch {
      // non-fatal
    }

    return messages
      .filter((m) => m && typeof m.id === "number")
      .map((m) => {
        const kind = mediaKindOf(m.media);
        const text = typeof m.message === "string" ? m.message : "";
        const out = !!m.out;
        const id = m.id as number;
        return {
          id,
          text,
          out,
          date: typeof m.date === "number" ? m.date : 0,
          hasMedia: !!m.media,
          mediaKind: kind,
          receipt: out ? receiptForOutgoing(id, readOutboxMaxId) : null,
        };
      })
      // GramJS returns newest-first; UI wants oldest-first.
      .reverse();
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** Download one message's media (for inbox thumbnails). */
export async function tgDownloadMessageMedia(opts: {
  session: string;
  peer: string;
  messageId: number;
}): Promise<{ data: Buffer; mime: string } | null> {
  const client = await connect(opts.session);
  try {
    const peer = await resolvePeer(opts.peer);
    const messages = (await client.getMessages(peer, {
      ids: [opts.messageId],
    })) as Array<{ media?: unknown; className?: string }>;
    const msg = messages[0];
    if (!msg?.media) return null;
    const kind = mediaKindOf(msg.media);
    const docMime = docMimeOf(msg.media);
    // GIFs and stickers need the real file so they animate / stay crisp.
    // Animated .tgs stickers can't render in a browser, so fall back to thumb.
    const wantFull =
      kind === "gif" ||
      (kind === "sticker" && docMime !== "application/x-tgsticker");
    const raw = await client.downloadMedia(msg, wantFull ? {} : { thumb: 1 });
    if (!raw) return null;
    const data = Buffer.isBuffer(raw)
      ? raw
      : typeof raw === "string"
        ? await (await import("fs/promises")).readFile(raw)
        : null;
    if (!data?.length) return null;
    const mime =
      kind === "gif"
        ? docMime.startsWith("video/")
          ? docMime
          : "video/mp4"
        : kind === "sticker"
          ? wantFull
            ? docMime || "image/webp"
            : sniffImageMime(data)
          : kind === "video"
            ? "video/mp4"
            : kind === "image"
              ? "image/jpeg"
              : "application/octet-stream";
    return { data, mime };
  } finally {
    await client.disconnect().catch(() => {});
  }
}

function dollarsLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/**
 * Price text as pixels: serverless hosts have no fonts, so SVG <text>
 * renders nothing there. Compose from pre-rendered glyph PNGs instead
 * (baseline-aligned via each glyph's canvas `top`).
 */
async function priceStripPng(
  label: string,
  digitHeight: number
): Promise<{ data: Buffer; w: number; h: number }> {
  const sharp = (await import("sharp")).default;
  const refDigitH = GLYPHS["0"].h;
  const s = digitHeight / refDigitH;
  const spacing = Math.max(1, Math.round(digitHeight * 0.08));

  const parts: { data: Buffer; w: number; h: number; top: number }[] = [];
  for (const ch of label) {
    const g = GLYPHS[ch];
    if (!g) continue;
    const w = Math.max(1, Math.round(g.w * s));
    const h = Math.max(1, Math.round(g.h * s));
    const data = await sharp(Buffer.from(g.b64, "base64"))
      .resize(w, h)
      .png()
      .toBuffer();
    parts.push({ data, w, h, top: Math.round(g.top * s) });
  }
  if (parts.length === 0) throw new Error("empty price label");

  const stripH = Math.ceil(GLYPH_CANVAS_H * s);
  const stripW = parts.reduce((sum, p) => sum + p.w, 0) + spacing * (parts.length - 1);
  let x = 0;
  const composites = parts.map((p) => {
    const c = { input: p.data, left: x, top: p.top };
    x += p.w + spacing;
    return c;
  });

  const data = await sharp({
    create: {
      width: stripW,
      height: stripH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
  return { data, w: stripW, h: stripH };
}

/**
 * Lolyfans-styled PPV badge: brand-gradient rounded square, white lock and
 * the price underneath (from pre-rendered glyphs).
 */
async function ppvBadgePng(priceCents: number, size = 220): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const S = size;
  const k = S / 220;
  const cx = S / 2;
  const svg = `
<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4fc9ff"/>
      <stop offset="0.55" stop-color="#00aff0"/>
      <stop offset="1" stop-color="#0086c9"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="${5 * k}" stdDeviation="${9 * k}" flood-color="#003a52" flood-opacity="0.5"/>
    </filter>
  </defs>
  <rect x="${12 * k}" y="${12 * k}" width="${S - 24 * k}" height="${S - 24 * k}"
        rx="${52 * k}" fill="url(#g)" filter="url(#glow)"/>
  <!-- lock shackle -->
  <path d="M ${cx - 21 * k} ${92 * k} v ${-16 * k} a ${21 * k} ${21 * k} 0 0 1 ${42 * k} 0 v ${16 * k}"
        fill="none" stroke="#ffffff" stroke-width="${12 * k}" stroke-linecap="round"/>
  <!-- lock body -->
  <rect x="${cx - 33 * k}" y="${92 * k}" width="${66 * k}" height="${54 * k}" rx="${13 * k}" fill="#ffffff"/>
  <circle cx="${cx}" cy="${116 * k}" r="${7 * k}" fill="#0090cf"/>
</svg>`;
  const base = await sharp(Buffer.from(svg)).png().toBuffer();

  const strip = await priceStripPng(dollarsLabel(priceCents), Math.round(30 * k));
  // Keep long prices inside the badge.
  let { data: stripData, w: stripW, h: stripH } = strip;
  const maxW = Math.round(S * 0.72);
  if (stripW > maxW) {
    const scale = maxW / stripW;
    stripW = maxW;
    stripH = Math.max(1, Math.round(stripH * scale));
    stripData = await sharp(stripData).resize(stripW, stripH).png().toBuffer();
  }
  return sharp(base)
    .composite([
      {
        input: stripData,
        left: Math.round((S - stripW) / 2),
        top: Math.round(152 * k),
      },
    ])
    .png()
    .toBuffer();
}

/** Lock + price badge centered, burned onto the image. */
async function compositeLockBadge(
  image: Buffer,
  priceCents: number
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(image).metadata();
  const w = meta.width || 600;
  const h = meta.height || 600;
  const badgeSize = Math.min(280, Math.max(150, Math.round(Math.min(w, h) * 0.42)));
  const badge = await ppvBadgePng(priceCents, badgeSize);
  return sharp(image)
    .composite([
      {
        input: badge,
        left: Math.round((w - badgeSize) / 2),
        top: Math.round((h - badgeSize) / 2),
      },
    ])
    .jpeg({ quality: 70 })
    .toBuffer();
}

/**
 * Blurred still preview of vault media — safe to show on the public unlock
 * page and to send as a Telegram photo teaser. Optional priceCents burns a
 * lock + $amount badge onto the center.
 */
export async function buildBlurredStill(
  mediaPath: string,
  mediaType: "image" | "video",
  priceCents?: number
): Promise<Buffer> {
  const original = await downloadMedia(mediaPath);
  let still: Buffer;
  if (mediaType === "video") {
    still = await blurredVideoFrame(original);
  } else {
    const sharp = (await import("sharp")).default;
    still = await sharp(original)
      .resize(600, 600, { fit: "inside", withoutEnlargement: true })
      .blur(40)
      .jpeg({ quality: 60 })
      .toBuffer();
  }
  if (priceCents && priceCents > 0) {
    return compositeLockBadge(still, priceCents);
  }
  return still;
}

/** Send a plain text reply into a Telegram dialog. */
export async function tgSendText(opts: {
  session: string;
  peer: string;
  text: string;
}): Promise<void> {
  const client = await connect(opts.session);
  try {
    const peer = await resolvePeer(opts.peer);
    await client.sendMessage(peer, { message: opts.text });
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** Run the bundled ffmpeg binary with the given args (throws on failure). */
async function runFfmpeg(args: string[], timeout = 45000): Promise<void> {
  const ffmpegPath = (await import("ffmpeg-static")).default as unknown as
    | string
    | null;
  if (!ffmpegPath) throw new Error("ffmpeg binary not available");
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  await promisify(execFile)(ffmpegPath, args, { timeout });
}


/**
 * Blurred video teaser: the first seconds, downscaled, heavily blurred and
 * muted — enough to see something is there, nothing usable before payment.
 * When priceCents is set, a lock + $ badge is overlaid in the center.
 */
async function blurredVideoClip(
  original: Buffer,
  priceCents?: number
): Promise<Buffer> {
  const fs = await import("fs/promises");
  const os = await import("os");
  const path = await import("path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-teaser-"));
  try {
    const inFile = path.join(dir, "in.bin");
    const outFile = path.join(dir, "out.mp4");
    await fs.writeFile(inFile, original);

    if (priceCents && priceCents > 0) {
      const badgeFile = path.join(dir, "badge.png");
      await fs.writeFile(badgeFile, await ppvBadgePng(priceCents, 170));
      await runFfmpeg([
        "-y",
        "-i", inFile,
        "-i", badgeFile,
        "-t", "3",
        "-an",
        "-filter_complex",
        "[0:v]scale=480:-2,boxblur=20:2[bg];[bg][1:v]overlay=(W-w)/2:(H-h)/2",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        outFile,
      ]);
    } else {
      await runFfmpeg([
        "-y",
        "-i", inFile,
        "-t", "3",
        "-an",
        "-vf", "scale=480:-2,boxblur=20:2",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        outFile,
      ]);
    }
    return await fs.readFile(outFile);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Fallback teaser: one frame from the video, blurred like an image teaser. */
async function blurredVideoFrame(original: Buffer): Promise<Buffer> {
  const fs = await import("fs/promises");
  const os = await import("os");
  const path = await import("path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-frame-"));
  try {
    const inFile = path.join(dir, "in.bin");
    const outFile = path.join(dir, "out.jpg");
    await fs.writeFile(inFile, original);
    await runFfmpeg(["-y", "-i", inFile, "-frames:v", "1", outFile]);
    const frame = await fs.readFile(outFile);
    const sharp = (await import("sharp")).default;
    return await sharp(frame)
      .resize(600, 600, { fit: "inside", withoutEnlargement: true })
      .blur(40)
      .jpeg({ quality: 60 })
      .toBuffer();
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Send a locked teaser into a fan's DM: blurred preview with lock+$ badge,
 * plus an HTML caption (e.g. "Tap Here to unlock"). Images blur with sharp;
 * videos become a short blurred muted clip (or a still frame if encode
 * fails), with a plain text message as the last resort.
 */
export async function tgSendTeaser(opts: {
  session: string;
  peer: string;
  mediaPath: string;
  mediaType: "image" | "video";
  caption: string;
  priceCents: number;
}): Promise<void> {
  const client = await connect(opts.session);
  try {
    const { CustomFile } = await gramjs();
    const peer = await resolvePeer(opts.peer);
    const sendOpts = {
      caption: opts.caption,
      parseMode: "html" as const,
      forceDocument: false,
    };
    if (opts.mediaType === "image") {
      // Named .jpg so Telegram renders a photo bubble (raw buffers often
      // become unnamed documents / text-only failures in some clients).
      const blurred = await buildBlurredStill(
        opts.mediaPath,
        "image",
        opts.priceCents
      );
      await client.sendFile(peer, {
        file: new CustomFile("teaser.jpg", blurred.length, "", blurred),
        ...sendOpts,
      });
      return;
    }

    const original = await downloadMedia(opts.mediaPath);
    // Best: a short blurred clip that shows as a real video bubble.
    try {
      const clip = await blurredVideoClip(original, opts.priceCents);
      await client.sendFile(peer, {
        file: new CustomFile("teaser.mp4", clip.length, "", clip),
        ...sendOpts,
        supportsStreaming: true,
      });
      return;
    } catch {
      // fall through to the still frame
    }
    // Good: a blurred still frame from the video + lock badge.
    try {
      const frame = await compositeLockBadge(
        await blurredVideoFrame(original),
        opts.priceCents
      );
      await client.sendFile(peer, {
        file: new CustomFile("teaser.jpg", frame.length, "", frame),
        ...sendOpts,
      });
      return;
    } catch {
      // fall through to plain text
    }
    // Last resort: text bubble with the HTML unlock link.
    await client.sendMessage(peer, {
      message: opts.caption,
      parseMode: "html",
    });
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** Deliver the clear media into the fan's DM after they pay. */
export async function tgDeliverMedia(opts: {
  session: string;
  peer: string;
  mediaPath: string;
  mediaType: "image" | "video";
  caption?: string;
}): Promise<void> {
  const client = await connect(opts.session);
  try {
    const { CustomFile } = await gramjs();
    const peer = await resolvePeer(opts.peer);
    const file = await downloadMedia(opts.mediaPath);
    // Keep the real file name (extension) so Telegram renders a playable
    // video / proper photo instead of a generic unnamed document.
    const base = opts.mediaPath.split("/").pop() || "";
    const name = /\.[a-z0-9]{2,5}$/i.test(base)
      ? base
      : opts.mediaType === "video"
        ? "media.mp4"
        : "media.jpg";
    await client.sendFile(peer, {
      file: new CustomFile(name, file.length, "", file),
      caption: opts.caption ?? "✅ Unlocked — enjoy!",
      videoNote: false,
      forceDocument: false,
      supportsStreaming: opts.mediaType === "video",
    });
  } finally {
    await client.disconnect().catch(() => {});
  }
}
