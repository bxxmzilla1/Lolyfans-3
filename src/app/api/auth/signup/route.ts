import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Creates an owner account only when the correct signup code is provided.
 * The code lives in SIGNUP_CODE (set in Vercel env vars) — never exposed to the client.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.SIGNUP_CODE;
  if (!expected) {
    return NextResponse.json(
      { error: "Sign up is not configured. Set SIGNUP_CODE in the environment." },
      { status: 503 }
    );
  }

  const { email, password, code } = await req.json();
  if (!email?.trim() || !password || password.length < 6) {
    return NextResponse.json(
      { error: "Email and a password of at least 6 characters are required" },
      { status: 400 }
    );
  }
  if (code !== expected) {
    return NextResponse.json({ error: "Invalid signup code" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin().auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, userId: data.user?.id });
}
