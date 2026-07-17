import { NextRequest, NextResponse } from "next/server";

/**
 * Verifies the admin code for gated actions (hiding messages, opening invite
 * links, owner escape hatch). The code lives in the ADMIN_CODE env var and is
 * only ever compared server-side. No login required — the code itself is the gate.
 */
export async function POST(req: NextRequest) {
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
