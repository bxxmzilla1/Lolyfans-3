"use client";

import { useState } from "react";
import { JoinChannelSheet } from "./InviteSubscribeCta";

/**
 * Profile-page "SUBSCRIBE" button for visitors without an account. Opens the
 * email + password sign-up sheet (using the creator's active invite code);
 * after joining, the fan lands straight in their private chat.
 */
export default function ProfileSubscribeCta({
  code,
  ownerId,
}: {
  code: string;
  ownerId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full px-5 py-3 rounded-full bg-accent text-white text-sm font-semibold text-center active:opacity-80 transition-opacity"
        >
          SUBSCRIBE
        </button>
        <p className="text-xs text-muted text-center">Free to subscribe</p>
      </div>

      {open && (
        <JoinChannelSheet
          code={code}
          ownerId={ownerId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
