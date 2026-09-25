import { NextResponse } from "next/server";
import { newWalletChallenge } from "@/lib/walletAuth";

/** Text for the fan to sign in Phantom (sign-up / log-in). */
export async function GET() {
  return NextResponse.json(newWalletChallenge(), {
    headers: { "Cache-Control": "no-store" },
  });
}
