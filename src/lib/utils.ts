export function mediaUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}

export const URL_REGEX = /(https?:\/\/[^\s<>"')\]]+)/g;

/** Markdown-style labeled link: [Payment Link](https://…) */
export const LABELED_LINK_REGEX = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g;

/** "[Payment Link](https://x)" -> "Payment Link" for chat previews and reply quotes. */
export function messagePreviewText(content: string): string {
  return content.replace(LABELED_LINK_REGEX, "$1");
}

/** First link in a message — labeled or bare. Locked media opens this on tap. */
export function firstLinkIn(content: string): string | null {
  const labeled = content.match(/\[[^\]\n]{1,200}\]\((https?:\/\/[^\s)]+)\)/);
  if (labeled) return labeled[1];
  const bare = content.match(/https?:\/\/[^\s<>"')\]]+/);
  return bare ? bare[0] : null;
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
