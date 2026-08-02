import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mediaUrl } from "@/lib/utils";

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
  getMe: () => Promise<{ username?: string; phone?: string }>;
  session: { save: () => string };
};

/** Stable peer key used in the inbox URL and send APIs. */
export type TgPeerKey =
  | `@${string}`
  | `user:${string}:${string}`
  | `channel:${string}:${string}`
  | `chat:${string}`;

export type TgDialog = {
  peer: string;
  title: string;
  username: string | null;
  kind: "user" | "group" | "channel";
  unread: number;
  preview: string;
  date: number;
  photoUrl: string | null;
};

export type TgMessage = {
  id: number;
  text: string;
  out: boolean;
  date: number;
  hasMedia: boolean;
  mediaKind: "image" | "video" | "other" | null;
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

/** List recent Telegram dialogs (DMs, groups, channels) for the connected account. */
export async function tgListDialogs(opts: {
  session: string;
  limit?: number;
}): Promise<TgDialog[]> {
  const client = await connect(opts.session);
  try {
    const dialogs = (await client.getDialogs({
      limit: opts.limit ?? 80,
    })) as Array<{
      title?: string;
      unreadCount?: number;
      date?: number;
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
      };
      message?: unknown;
    }>;

    return dialogs
      .filter((d) => d.entity)
      .map((d) => {
        const entity = d.entity!;
        return {
          peer: entityPeerKey(entity),
          title: d.title || entity.username || "Telegram",
          username: entity.username ? String(entity.username) : null,
          kind: entityKind(entity),
          unread: d.unreadCount ?? 0,
          preview: messagePreview(d.message),
          date: typeof d.date === "number" ? d.date : 0,
          photoUrl: null,
        };
      });
  } finally {
    await client.disconnect().catch(() => {});
  }
}

function mediaKindOf(media: unknown): TgMessage["mediaKind"] {
  if (!media || typeof media !== "object") return null;
  const cls = String((media as { className?: string }).className || "");
  if (cls.includes("MessageMediaPhoto") || cls.includes("Photo")) return "image";
  if (cls.includes("MessageMediaDocument") || cls.includes("Document")) {
    const doc = (media as { document?: { mimeType?: string; attributes?: Array<{ className?: string }> } })
      .document;
    const mime = String(doc?.mimeType || "");
    if (mime.startsWith("video/") || doc?.attributes?.some((a) => String(a.className || "").includes("Video"))) {
      return "video";
    }
    if (mime.startsWith("image/")) return "image";
    return "other";
  }
  return "other";
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
    const messages = (await client.getMessages(peer, {
      limit: opts.limit ?? 40,
    })) as Array<{
      id?: number;
      message?: string;
      out?: boolean;
      date?: number;
      media?: unknown;
    }>;

    return messages
      .filter((m) => m && typeof m.id === "number")
      .map((m) => {
        const kind = mediaKindOf(m.media);
        const text = typeof m.message === "string" ? m.message : "";
        return {
          id: m.id as number,
          text,
          out: !!m.out,
          date: typeof m.date === "number" ? m.date : 0,
          hasMedia: !!m.media,
          mediaKind: kind,
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
    const raw = await client.downloadMedia(msg, { thumb: 1 });
    if (!raw) return null;
    const data = Buffer.isBuffer(raw)
      ? raw
      : typeof raw === "string"
        ? await (await import("fs/promises")).readFile(raw)
        : null;
    if (!data?.length) return null;
    const mime =
      kind === "video"
        ? "video/mp4"
        : kind === "image"
          ? "image/jpeg"
          : "application/octet-stream";
    return { data, mime };
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/**
 * Blurred still preview of vault media — safe to show on the public unlock
 * page and to send as a Telegram photo teaser.
 */
export async function buildBlurredStill(
  mediaPath: string,
  mediaType: "image" | "video"
): Promise<Buffer> {
  const original = await downloadMedia(mediaPath);
  if (mediaType === "video") {
    return blurredVideoFrame(original);
  }
  const sharp = (await import("sharp")).default;
  return sharp(original)
    .resize(600, 600, { fit: "inside", withoutEnlargement: true })
    .blur(40)
    .jpeg({ quality: 60 })
    .toBuffer();
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
async function runFfmpeg(args: string[]): Promise<void> {
  const ffmpegPath = (await import("ffmpeg-static")).default as unknown as
    | string
    | null;
  if (!ffmpegPath) throw new Error("ffmpeg binary not available");
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  await promisify(execFile)(ffmpegPath, args, { timeout: 45000 });
}

/**
 * Blurred video teaser: the first seconds, downscaled, heavily blurred and
 * muted — enough to see something is there, nothing usable before payment.
 */
async function blurredVideoClip(original: Buffer): Promise<Buffer> {
  const fs = await import("fs/promises");
  const os = await import("os");
  const path = await import("path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-teaser-"));
  try {
    const inFile = path.join(dir, "in.bin");
    const outFile = path.join(dir, "out.mp4");
    await fs.writeFile(inFile, original);
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
 * Send a locked teaser into a fan's DM: a heavily blurred preview plus the
 * caption with the unlock link. Images blur with sharp; videos become a
 * short blurred muted clip (or a blurred still frame if the clip encode
 * fails), with a plain text message as the last resort.
 */
export async function tgSendTeaser(opts: {
  session: string;
  peer: string;
  mediaPath: string;
  mediaType: "image" | "video";
  caption: string;
}): Promise<void> {
  const client = await connect(opts.session);
  try {
    const { CustomFile } = await gramjs();
    const peer = await resolvePeer(opts.peer);
    if (opts.mediaType === "image") {
      // Named .jpg so Telegram renders a photo bubble (raw buffers often
      // become unnamed documents / text-only failures in some clients).
      const blurred = await buildBlurredStill(opts.mediaPath, "image");
      await client.sendFile(peer, {
        file: new CustomFile("teaser.jpg", blurred.length, "", blurred),
        caption: opts.caption,
        forceDocument: false,
      });
      return;
    }

    const original = await downloadMedia(opts.mediaPath);
    // Best: a short blurred clip that shows as a real video bubble.
    try {
      const clip = await blurredVideoClip(original);
      await client.sendFile(peer, {
        file: new CustomFile("teaser.mp4", clip.length, "", clip),
        caption: opts.caption,
        forceDocument: false,
        supportsStreaming: true,
      });
      return;
    } catch {
      // fall through to the still frame
    }
    // Good: a blurred still frame from the video.
    try {
      const frame = await blurredVideoFrame(original);
      await client.sendFile(peer, {
        file: new CustomFile("teaser.jpg", frame.length, "", frame),
        caption: opts.caption,
        forceDocument: false,
      });
      return;
    } catch {
      // fall through to plain text
    }
    // Last resort: the old text bubble with the link.
    await client.sendMessage(peer, {
      message: `🔒 Locked video\n\n${opts.caption}`,
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
