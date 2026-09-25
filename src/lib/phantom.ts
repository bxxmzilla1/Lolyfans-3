"use client";

/**
 * Browser-side Phantom helpers for USDC top-ups. The heavy Solana libraries
 * are imported lazily so the chat bundle doesn't pay for them until a fan
 * actually picks "Pay with crypto".
 */

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  signAndSendTransaction(tx: unknown): Promise<{ signature: string }>;
  signMessage(
    message: Uint8Array,
    display?: "utf8" | "hex"
  ): Promise<{ signature: Uint8Array; publicKey?: { toBase58(): string } }>;
};

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
    solana?: PhantomProvider;
  }
}

/** Phantom's injected provider, when this browser has the extension / app. */
export function phantomProvider(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const p = window.phantom?.solana ?? window.solana;
  return p?.isPhantom ? p : null;
}

export function isMobileBrowser(): boolean {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * On a phone without the provider (Safari, Instagram's browser…) the page has
 * to open inside Phantom's own browser, where the wallet is available.
 */
export function phantomBrowseUrl(url: string): string {
  const ref = new URL(url).origin;
  return `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}`;
}

/**
 * No Phantom here? Phones jump into Phantom's in-app browser (returns true:
 * the page is navigating away); desktops get the install page and false.
 */
export function ensurePhantomOrRedirect(): boolean {
  if (phantomProvider()) return true;
  if (isMobileBrowser()) {
    window.location.href = phantomBrowseUrl(window.location.href);
    return true;
  }
  window.open("https://phantom.app/download", "_blank", "noopener");
  return false;
}

export type WalletSignIn = { publicKey: string; signature: string; challenge: string };

/** Was the error the fan closing / rejecting the Phantom prompt? */
export function isPhantomCancel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /reject|cancel|denied|closed/i.test(msg);
}

/**
 * "Continue with Phantom": connect, sign the server's challenge text (free,
 * no transaction) and return what the server needs to verify the wallet.
 */
export async function signInWithPhantom(): Promise<WalletSignIn> {
  const provider = phantomProvider();
  if (!provider) throw new Error("Phantom wallet not found");
  const [{ publicKey }, challengeRes] = await Promise.all([
    provider.connect(),
    fetch("/api/wallet/challenge", { cache: "no-store" }),
  ]);
  const { message, challenge } = (await challengeRes.json()) as {
    message: string;
    challenge: string;
  };
  const signed = await provider.signMessage(new TextEncoder().encode(message), "utf8");
  const signature = btoa(String.fromCharCode(...signed.signature));
  return {
    publicKey: (signed.publicKey ?? publicKey).toBase58(),
    signature,
    challenge,
  };
}

export type CryptoQuote = {
  reference: string;
  receiver: string;
  mint: string;
  amountMicro: number;
  amountCents?: number;
  tokens?: number;
  packId?: string;
  kind?: string;
};

export type CryptoResult = {
  ok?: boolean;
  kind?: string;
  tokens?: number;
  amountCents?: number;
  packId?: string | null;
  balance?: number;
  accessUntil?: string | null;
  alreadyCredited?: boolean;
};

/**
 * Full USDC checkout: quote from the server, one Phantom approval, then poll
 * until the payment is confirmed on chain and fulfilled. `intent` is the
 * body for /api/payments/crypto/intent (pack, coupon or subscription).
 */
export async function payWithPhantom(
  intent: Record<string, unknown>,
  onStatus?: (status: string) => void
): Promise<CryptoResult> {
  onStatus?.("Preparing payment…");
  const res = await fetch("/api/payments/crypto/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(intent),
  });
  const quote = (await res.json().catch(() => ({}))) as CryptoQuote & { error?: string };
  if (!res.ok) throw new Error(quote.error || "Could not start the payment");

  onStatus?.("Approve the payment in Phantom…");
  const signature = await payUsdcWithPhantom(quote);

  onStatus?.("Confirming on the blockchain…");
  const deadline = Date.now() + 120_000;
  let data: CryptoResult & { error?: string; pending?: boolean } = {};
  while (Date.now() < deadline) {
    const c = await fetch("/api/payments/crypto/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference: quote.reference, signature }),
    });
    data = await c.json().catch(() => ({}));
    if (c.status !== 202) {
      if (!c.ok) throw new Error(data.error || "Payment could not be confirmed");
      break;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (!data.ok) {
    throw new Error("Still confirming — it will be applied once the network settles.");
  }
  return data;
}

/**
 * Build the USDC transfer, have Phantom sign + send it, return the signature.
 * The reference key rides along as an extra read-only account so the server
 * can match the transaction to this top-up.
 */
export async function payUsdcWithPhantom(quote: CryptoQuote): Promise<string> {
  const provider = phantomProvider();
  if (!provider) throw new Error("Phantom wallet not found");

  const [{ Connection, PublicKey, Transaction }, spl] = await Promise.all([
    import("@solana/web3.js"),
    import("@solana/spl-token"),
  ]);

  const { publicKey } = await provider.connect();
  const payer = new PublicKey(publicKey.toBase58());
  const receiver = new PublicKey(quote.receiver);
  const mint = new PublicKey(quote.mint);
  const reference = new PublicKey(quote.reference);

  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "confirmed");

  const fromAta = spl.getAssociatedTokenAddressSync(mint, payer);
  const toAta = spl.getAssociatedTokenAddressSync(mint, receiver);

  // Enough USDC? A clear message beats a cryptic wallet error.
  try {
    const bal = await connection.getTokenAccountBalance(fromAta);
    if (BigInt(bal.value.amount) < BigInt(quote.amountMicro)) {
      throw new Error("Not enough USDC in your Phantom wallet");
    }
  } catch (err) {
    if (err instanceof Error && /Not enough USDC/.test(err.message)) throw err;
    throw new Error("No USDC found in your Phantom wallet");
  }

  const transfer = spl.createTransferCheckedInstruction(
    fromAta,
    mint,
    toAta,
    payer,
    BigInt(quote.amountMicro),
    6
  );
  transfer.keys.push({ pubkey: reference, isSigner: false, isWritable: false });

  const tx = new Transaction()
    // Creates the receiver's USDC account if it somehow doesn't exist yet;
    // a no-op otherwise.
    .add(spl.createAssociatedTokenAccountIdempotentInstruction(payer, toAta, receiver, mint))
    .add(transfer);
  tx.feePayer = payer;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  const { signature } = await provider.signAndSendTransaction(tx);
  return signature;
}
