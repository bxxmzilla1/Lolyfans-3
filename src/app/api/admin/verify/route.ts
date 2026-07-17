import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";

/**
 * Verifies the admin code for gated owner actions (hiding messages,
 * opening invite links). The code lives in the ADMIN_CODE env var.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const expected = process.env.ADMIN_CODE;
  if (!expected) {
    return NextResponse.json(
      { error: "Admin code is not configured. Set ADMIN_CODE in the environment." },
      { status: 503 }
    );
  }

  const { code } = await req.json();
  if (code !== expected) {
    return NextResponse.json({ error: "Invalid admin code" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
