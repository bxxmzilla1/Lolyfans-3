import "server-only";
import crypto from "crypto";
import { PublicKey } from "@solana/web3.js";
import { createToken, verifyToken } from "@/lib/session";

/**
 * Sign in with Phantom: the fan signs a one-time text message (free, no
 * transaction). The challenge is a server-signed token, so no nonce table is
 * needed — it just has to be fresh and match the signed text.
 */

const MAX_AGE_MS = 10 * 60_000;

type Challenge = { k: "wallet-challenge"; n: string; t: string };

function challengeMessage(nonce: string, issuedAt: string): string {
  return [
    "Sign in to Lolyfans",
    "",
    "This proves you own this wallet. It's free and doesn't send a transaction.",
    "",
    `Nonce: ${nonce}`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
}

export function newWalletChallenge(): { message: string; challenge: string } {
  const payload: Challenge = {
    k: "wallet-challenge",
    n: crypto.randomBytes(16).toString("hex"),
    t: new Date().toISOString(),
  };
  return { message: challengeMessage(payload.n, payload.t), challenge: createToken(payload) };
}

/** The wallet address when the signature is valid and fresh, otherwise null. */
export function verifyWalletSignIn(input: {
  publicKey?: unknown;
  signature?: unknown;
  challenge?: unknown;
}): string | null {
  if (
    typeof input.publicKey !== "string" ||
    typeof input.signature !== "string" ||
    typeof input.challenge !== "string"
  ) {
    return null;
  }
  const payload = verifyToken<Challenge>(input.challenge);
  if (!payload || payload.k !== "wallet-challenge") return null;
  const age = Date.now() - Date.parse(payload.t);
  if (!(age >= 0 && age <= MAX_AGE_MS)) return null;

  let wallet: PublicKey;
  try {
    wallet = new PublicKey(input.publicKey);
  } catch {
    return null;
  }
  const signature = Buffer.from(input.signature, "base64");
  if (signature.length !== 64) return null;

  const key = crypto.createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(wallet.toBytes()).toString("base64url"),
    },
    format: "jwk",
  });
  const ok = crypto.verify(
    null,
    Buffer.from(challengeMessage(payload.n, payload.t), "utf8"),
    key,
    signature
  );
  return ok ? wallet.toBase58() : null;
}

/** "7xKX…9fQa" — default display name for wallet sign-ups. */
export function shortWallet(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
