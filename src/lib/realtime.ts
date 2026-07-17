/** Broadcast an event to a realtime channel from the server (no websocket needed). */
export async function broadcast(topic: string, event: string, payload: unknown) {
  try {
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
      body: JSON.stringify({ messages: [{ topic, event, payload }] }),
    });
  } catch {
    // Realtime is best-effort; clients also refetch on focus.
  }
}
