export function mediaUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}

export type MediaItem = { path: string; type: "image" | "video" };

/** Normalize legacy single media_path + optional media_items into one list. */
export function mediaItemsFromMessage(message: {
  media_path?: string | null;
  media_type?: string | null;
  media_items?: unknown;
}): MediaItem[] {
  const items: MediaItem[] = [];
  const raw = Array.isArray(message.media_items) ? message.media_items : [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const path = (entry as { path?: unknown }).path;
    const type = (entry as { type?: unknown }).type;
    if (typeof path !== "string" || !path) continue;
    if (type !== "image" && type !== "video") continue;
    items.push({ path, type });
  }
  if (items.length === 0 && message.media_path) {
    const type = message.media_type === "video" ? "video" : "image";
    items.push({ path: message.media_path, type });
  }
  return items;
}

export const URL_REGEX = /(https?:\/\/[^\s<>"')\]]+)/g;

/**
 * Attached chat link: [Label](https://…) with two optional parts — the label
 * may be empty (hidden link, the media itself becomes the tap target) and a
 * price can ride along as [Label]{25}(https://…).
 */
export const LABELED_LINK_REGEX =
  /\[([^\]\n]{0,200})\](?:\{[^}\n]{0,20}\})?\((https?:\/\/[^\s)]+)\)/g;

/** Strip internal Stripe tip receipt tokens from stored message text. */
export function stripPaymentReceipt(content: string): string {
  return content.replace(/\n⌞[^⌟]+⌟\s*$/u, "").trimEnd();
}

/** "[Payment Link](https://x)" -> "Payment Link" for chat previews and reply quotes. */
export function messagePreviewText(content: string): string {
  const cleaned = stripPaymentReceipt(content)
    .replace(LABELED_LINK_REGEX, (_m, label: string) => label?.trim() || "Link")
    .trim();
  const tip = cleaned.match(/^💸 Tip · (\$[\d.]+)/);
  if (tip) return `Tip · ${tip[1]}`;
  return cleaned;
}

/** First link in a message — labeled or bare. Locked media opens this on tap. */
export function firstLinkIn(content: string): string | null {
  const labeled = content.match(
    /\[[^\]\n]{0,200}\](?:\{[^}\n]{0,20}\})?\((https?:\/\/[^\s)]+)\)/
  );
  if (labeled) return labeled[1];
  const bare = content.match(/https?:\/\/[^\s<>"')\]]+/);
  return bare ? bare[0] : null;
}

/** Price attached to the message's link ([Label]{25}(url)), if any. */
export function linkPriceIn(content: string): string | null {
  const m = content.match(/\[[^\]\n]{0,200}\]\{([^}\n]{1,20})\}\(https?:\/\/[^\s)]+\)/);
  return m ? m[1] : null;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** 1234 -> "1.2K", 2500000 -> "2.5M" — social-style compact counts. */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export type MediaKind = "image" | "video";

export function fileKind(file: File): MediaKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

/**
 * Downscale an image in the browser so the stored file is small and renders
 * fast (profile pictures don't need more than ~480px). Returns the original
 * file when it's already small enough or can't be decoded (e.g. exotic format).
 */
export async function resizeImage(file: File, maxSize = 480): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = maxSize / Math.max(bitmap.width, bitmap.height);
    if (scale >= 1) {
      bitmap.close();
      return file;
    }
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
