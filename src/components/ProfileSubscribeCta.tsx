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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full px-5 py-3 rounded-full bg-accent text-white text-sm font-semibold active:opacity-80 transition-opacity flex items-center justify-between"
      >
        <span>SUBSCRIBE</span>
        <span>FREE</span>
      </button>

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
