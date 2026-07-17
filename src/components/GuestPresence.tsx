"use client";

import { useEffect } from "react";
import { trackGuestPresence } from "@/lib/guestPresence";

/**
 * Invisible: while the guest has their chat page open, they announce presence
 * on the owner's guest-presence channel so the owner sees them as online.
 */
export default function GuestPresence({
  chatId,
  ownerId,
}: {
  chatId: string;
  ownerId: string;
}) {
  useEffect(() => trackGuestPresence(ownerId, chatId), [ownerId, chatId]);
  return null;
}
