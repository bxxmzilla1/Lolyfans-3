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

export type CryptoQuote = {
  reference: string;
  receiver: string;
  mint: string;
  amountMicro: number;
};

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
