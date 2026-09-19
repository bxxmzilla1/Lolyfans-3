/**
 * Point the fan's session at their chat with `ownerId` (starting one if
 * needed) and return the path to navigate to. Falls back to the creator's
 * profile when the fan has no account.
 */
export async function openCreatorChat(ownerId: string): Promise<string> {
  try {
    const res = await fetch("/api/guest/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId }),
    });
    if (res.ok) return "/chat";
  } catch {
    // fall through
  }
  return `/p/${ownerId}`;
}
