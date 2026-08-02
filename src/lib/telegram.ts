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
  getMe: () => Promise<{ username?: string; phone?: string }>;
  session: { save: () => string };
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
    if (opts.mediaType === "image") {
      const sharp = (await import("sharp")).default;
      const original = await downloadMedia(opts.mediaPath);
      // Downscale then blur hard so nothing usable shows before payment.
      const blurred = await sharp(original)
        .resize(600, 600, { fit: "inside", withoutEnlargement: true })
        .blur(40)
        .jpeg({ quality: 60 })
        .toBuffer();
      await client.sendFile(opts.peer, {
        file: blurred,
        caption: opts.caption,
        forceDocument: false,
      });
      return;
    }

    const original = await downloadMedia(opts.mediaPath);
    // Best: a short blurred clip that shows as a real video bubble. The
    // CustomFile wrapper gives the buffer an .mp4 name so Telegram treats
    // it as a playable video instead of a generic document.
    try {
      const { CustomFile } = await gramjs();
      const clip = await blurredVideoClip(original);
      await client.sendFile(opts.peer, {
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
      await client.sendFile(opts.peer, {
        file: frame,
        caption: opts.caption,
        forceDocument: false,
      });
      return;
    } catch {
      // fall through to plain text
    }
    // Last resort: the old text bubble with the link.
    await client.sendMessage(opts.peer, {
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
    const file = await downloadMedia(opts.mediaPath);
    // Keep the real file name (extension) so Telegram renders a playable
    // video / proper photo instead of a generic unnamed document.
    const base = opts.mediaPath.split("/").pop() || "";
    const name = /\.[a-z0-9]{2,5}$/i.test(base)
      ? base
      : opts.mediaType === "video"
        ? "media.mp4"
        : "media.jpg";
    await client.sendFile(opts.peer, {
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
