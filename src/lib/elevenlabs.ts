/**
 * ElevenLabs text-to-speech (Eleven v3) used to generate personalized welcome
 * voice notes. The creator writes a script with a FIRSTNAME placeholder; at
 * signup we swap in the fan's first name and synthesize a unique MP3.
 */

export const FIRSTNAME_PLACEHOLDER = "FIRSTNAME";

// Pictographic emoji, skin tones, variation selectors, ZWJ and flag letters —
// stripped from names so the voice never tries to "read" an emoji mid-name.
// Digits are intentionally NOT matched (they get the "Mister" fallback below).
const EMOJI_RE =
  /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu;

/**
 * Turn a fan's full name into something a voice can naturally pronounce.
 *
 * - First name = everything before the first space ("Andre Arroyo" → "Andre").
 * - Emojis are ignored ("Andre🔥" → "Andre").
 * - If what's left isn't a normal name (single letters, numbers, emoji…) we
 *   fall back to "Mister <first character>" ("123abc" → "Mister 1").
 * - Returns "" when there is nothing usable at all.
 */
export function spokenFirstName(fullName: string): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return "";

  const cleaned = first.replace(EMOJI_RE, "").trim();

  // A pronounceable name: starts with a letter, 2+ chars, letters/'/- only.
  if (/^\p{L}[\p{L}'’-]+$/u.test(cleaned)) {
    return cleaned[0].toUpperCase() + cleaned.slice(1);
  }

  // Otherwise say "Mister" + the first character (letter, number or emoji).
  const ch = Array.from(cleaned || first)[0] ?? "";
  if (!ch) return "";
  return `Mister ${/\p{L}/u.test(ch) ? ch.toUpperCase() : ch}`;
}

/** Replace every FIRSTNAME placeholder in the creator's script. */
export function personalizeScript(script: string, fullName: string): string {
  const name = spokenFirstName(fullName);
  return script
    .split(FIRSTNAME_PLACEHOLDER)
    .join(name)
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Synthesize speech with the Eleven v3 model. The script may include v3
 * audio tags like [whispers] or [excited] for expressive delivery — that is
 * how "enhanced" v3 output is driven through the public API.
 * Returns the MP3 bytes, or throws with the API's error message.
 */
export async function elevenLabsTts(
  apiKey: string,
  voiceId: string,
  text: string
): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      voiceId
    )}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: text.slice(0, 4900),
        model_id: "eleven_v3",
      }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.arrayBuffer();
}
