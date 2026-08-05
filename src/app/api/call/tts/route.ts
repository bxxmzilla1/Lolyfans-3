import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { creatorVoiceId, guestCall } from "@/lib/voiceCall";

export const maxDuration = 60;

/**
 * Speak one call turn's reply. Streams ElevenLabs Flash (their low-latency
 * model) straight through, so the browser's <audio> starts playing the
 * moment the first chunk arrives — this is what makes the call feel live.
 * GET so an <audio src> can play it natively with progressive buffering.
 */
export async function GET(req: NextRequest) {
  const turnId = req.nextUrl.searchParams.get("turn")?.trim();
  if (!turnId) {
    return NextResponse.json({ error: "turn required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: turn } = await db
    .from("voice_call_turns")
    .select("call_id, reply")
    .eq("id", turnId)
    .maybeSingle();
  if (!turn?.reply) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const call = await guestCall(req.headers, turn.call_id as string);
  if (!call) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Voice is not configured" }, { status: 503 });
  }
  const voiceId = await creatorVoiceId(call.owner_id);
  if (!voiceId) {
    return NextResponse.json({ error: "Voice is not configured" }, { status: 503 });
  }

  // Flash doesn't understand v3 audio tags like [giggles] — strip them so
  // they're never read out loud.
  const text = String(turn.reply).replace(/\[[^\]]{1,40}\]/g, " ").trim();
  if (!text) return NextResponse.json({ error: "Nothing to say" }, { status: 400 });

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream` +
      `?output_format=mp3_44100_64&optimize_streaming_latency=3`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_flash_v2_5",
        voice_settings: { stability: 0.5 },
      }),
    }
  ).catch(() => null);

  if (!upstream?.ok || !upstream.body) {
    return NextResponse.json({ error: "Voice generation failed" }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
