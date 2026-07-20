import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ownerFromApiKey } from "@/lib/apiKey";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Connection info for external apps (Orion) to listen to this owner's inbox
 * in real time. Returns the public Supabase URL + anon key and the owner id,
 * so Orion can subscribe to the `inbox:<ownerId>` broadcast channel and react
 * to new messages / new chats the instant they happen.
 */
export async function GET(req: NextRequest) {
  const ownerId = await ownerFromApiKey(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS });
  }

  // The creator's display name, so the connected chatbot can identify itself
  // as this creator when fans ask who they're talking to.
  let creatorName = "";
  try {
    const { data } = await supabaseAdmin().auth.admin.getUserById(ownerId);
    creatorName = (data?.user?.user_metadata?.display_name as string) || "";
  } catch {
    // name is optional — realtime info still works without it
  }

  return NextResponse.json(
    {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ownerId,
      creatorName,
      channel: `inbox:${ownerId}`,
    },
    { headers: CORS }
  );
}
