import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Eleven v3 renders long, tag-heavy scripts slowly.
export const maxDuration = 300;

/**
 * Turn typed chat text into speech with ElevenLabs (Eleven v3, stability 0.5,
 * mp3 44.1kHz 128kbps). Expressions like [giggles] or [whispers] are v3 audio
 * tags and go through as-is. Uses the creator's saved Voice ID from Settings.
 * Returns raw audio/mpeg for the in-chat preview player.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Type the message first" }, { status: 400 });
  }
  if (text.length > 4800) {
    return NextResponse.json(
      { error: "Text is too long for one voice note (max ~4800 characters)" },
      { status: 400 }
    );
  }

  const apiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not set on the server" },
      { status: 503 }
    );
  }

  const { data } = await supabaseAdmin().auth.admin.getUserById(ownerId);
  const voiceId = String(
    (data?.user?.user_metadata as { eleven_voice_id?: string } | undefined)
      ?.eleven_voice_id || ""
  ).trim();
  if (!voiceId) {
    return NextResponse.json(
      { error: "Add your ElevenLabs Voice ID in Settings → Telegram first" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_v3",
          voice_settings: { stability: 0.5 },
        }),
      }
    );
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let detail = "";
      try {
        const parsed = JSON.parse(raw) as {
          detail?: { message?: string } | string;
        };
        detail =
          typeof parsed.detail === "string"
            ? parsed.detail
            : parsed.detail?.message || "";
      } catch {
        // non-JSON error body
      }
      return NextResponse.json(
        { error: detail || `ElevenLabs error (${res.status})` },
        { status: 502 }
      );
    }
    const audio = await res.arrayBuffer();
    if (!audio.byteLength) {
      return NextResponse.json(
        { error: "ElevenLabs returned no audio" },
        { status: 502 }
      );
    }
    return new NextResponse(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach ElevenLabs" },
      { status: 502 }
    );
  }
}
