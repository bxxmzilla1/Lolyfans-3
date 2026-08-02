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
 * Send a locked teaser into a fan's DM: a heavily blurred preview (for images)
 * plus the caption with the unlock link. Videos send a lock caption + link
 * (no server-side frame extraction available). Returns nothing on success.
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
    } else {
      await client.sendMessage(opts.peer, {
        message: `🔒 Locked video\n\n${opts.caption}`,
      });
    }
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
    const file = await downloadMedia(opts.mediaPath);
    await client.sendFile(opts.peer, {
      file,
      caption: opts.caption ?? "✅ Unlocked — enjoy!",
      videoNote: false,
      forceDocument: false,
    });
  } finally {
    await client.disconnect().catch(() => {});
  }
}
