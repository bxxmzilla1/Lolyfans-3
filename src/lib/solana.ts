import { Keypair } from "@solana/web3.js";

/**
 * Crypto top-ups: fans pay USDC on Solana from Phantom. Server side we only
 * need to READ the chain (plain JSON-RPC, no wallet), so the app never holds
 * a private key.
 *
 * Env:
 *  - NEXT_PUBLIC_SOLANA_USDC_RECEIVER — the wallet that receives payments
 *    (a public key, so it's safe in the browser; it also switches the
 *    "Crypto" option on in the wallet sheet).
 *  - SOLANA_RPC_URL        — RPC endpoint (defaults to Solana's public one;
 *                            a Helius / QuickNode URL is far more reliable).
 *  - NEXT_PUBLIC_SOLANA_RPC_URL — same, for the browser.
 */

/** USDC mint on Solana mainnet (6 decimals). */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTSDt";
export const USDC_DECIMALS = 6;

export function solanaRpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com"
  );
}

export function cryptoReceiver(): string | null {
  const v = (
    process.env.NEXT_PUBLIC_SOLANA_USDC_RECEIVER ||
    process.env.SOLANA_USDC_RECEIVER ||
    ""
  ).trim();
  return v || null;
}

export function cryptoConfigured(): boolean {
  return !!cryptoReceiver();
}

/** Cents → USDC base units (1 USDC = 1,000,000). */
export function centsToMicroUsdc(cents: number): number {
  return Math.round(cents) * 10_000;
}

/** A fresh random public key, used once as the payment reference. */
export function newReference(): string {
  return Keypair.generate().publicKey.toBase58();
}

type ParsedTx = {
  meta: {
    err: unknown;
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } | null;
  transaction: {
    message: {
      accountKeys: { pubkey: string; signer: boolean; writable: boolean }[];
    };
  };
  blockTime?: number | null;
};

type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
};

export type VerifyResult =
  | { status: "pending" }
  | { status: "failed"; reason: string }
  | { status: "ok"; payer: string | null; receivedMicro: bigint };

/**
 * Look the transaction up on chain and check it really paid us: confirmed,
 * no error, includes the reference key, and moved at least `amountMicro`
 * USDC into the receiver's wallet.
 */
export async function verifyUsdcPayment(opts: {
  signature: string;
  reference: string;
  amountMicro: number;
}): Promise<VerifyResult> {
  const receiver = cryptoReceiver();
  if (!receiver) return { status: "failed", reason: "Crypto payments are not configured" };

  const res = await fetch(solanaRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        opts.signature,
        { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ],
    }),
    cache: "no-store",
  });
  if (!res.ok) return { status: "pending" };
  const body = (await res.json().catch(() => null)) as
    | { result?: ParsedTx | null; error?: { message?: string } }
    | null;
  if (!body || body.error) return { status: "pending" };
  const tx = body.result;
  // Not indexed yet — the client keeps polling.
  if (!tx || !tx.meta) return { status: "pending" };
  if (tx.meta.err) return { status: "failed", reason: "The transaction failed on chain" };

  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  if (!keys.includes(opts.reference)) {
    return { status: "failed", reason: "This transaction is not for this top-up" };
  }

  const sum = (list: TokenBalance[] | undefined) =>
    (list ?? [])
      .filter((b) => b.mint === USDC_MINT && b.owner === receiver)
      .reduce((acc, b) => acc + BigInt(b.uiTokenAmount.amount), BigInt(0));
  const received = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
  if (received < BigInt(opts.amountMicro)) {
    return { status: "failed", reason: "The payment amount doesn't match" };
  }

  const payer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey ?? null;
  return { status: "ok", payer, receivedMicro: received };
}
