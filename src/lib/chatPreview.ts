import { messagePreviewText } from "@/lib/utils";

/** Shape stored on each inbox row / carried on inbox broadcasts. */
export type ChatPreview = {
  content: string | null;
  media_type: string | null;
};

/**
 * Human label for an inbox row. Prefer text, then media kind. "New chat" only
 * when we truly have no message to describe.
 */
export function chatPreviewLabel(preview: ChatPreview | null | undefined): string {
  if (!preview) return "New chat";
  const text = preview.content ? messagePreviewText(preview.content) : "";
  if (text) return text;
  if (preview.media_type === "image") return "Photo";
  if (preview.media_type === "video") return "Video";
  if (preview.media_type === "audio") return "Voice note";
  // A preview row existed (message was found) but had no usable fields —
  // don't lie and say the chat is brand new.
  return "Message";
}

/** Best media type from legacy columns + media_items JSON. */
export function previewMediaType(message: {
  media_type?: string | null;
  media_items?: unknown;
}): string | null {
  if (
    message.media_type === "image" ||
    message.media_type === "video" ||
    message.media_type === "audio"
  ) {
    return message.media_type;
  }
  if (Array.isArray(message.media_items)) {
    for (const entry of message.media_items) {
      if (!entry || typeof entry !== "object") continue;
      const type = (entry as { type?: unknown }).type;
      if (type === "image" || type === "video" || type === "audio") return type;
    }
  }
  return null;
}
