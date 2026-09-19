"use client";

import { useState } from "react";
import { JoinChannelSheet } from "./InviteSubscribeCta";
import { subCaption, subCtaLabel, type SubPlan } from "@/lib/subscriptionPlan";

/**
 * Profile-page "SUBSCRIBE" bar. Visitors get the sign-up sheet (name, email,
 * password — then the card step on paid profiles). Fans who signed up but
 * never added a card (`cardOnly`) reopen straight at the card step.
 */
export default function ProfileSubscribeCta({
  code,
  ownerId,
  ownerName,
  plan,
  cardOnly = false,
  autoOpen = false,
}: {
  code: string;
  ownerId: string;
  ownerName?: string;
  plan?: SubPlan | null;
  cardOnly?: boolean;
  /** Open the sheet on load (e.g. arriving via ?subscribe=1). */
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const paid = !!plan && plan.priceCents > 0;
  const caption = paid && plan ? subCaption(plan) : null;

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full px-5 py-3 rounded-full bg-accent text-white text-sm font-semibold active:opacity-80 transition-opacity flex items-center justify-between"
      >
        <span>SUBSCRIBE</span>
        <span>{plan ? subCtaLabel(plan) : "FREE"}</span>
      </button>
      {caption && <p className="text-xs text-muted text-center">{caption}</p>}

      {open && (
        <JoinChannelSheet
          code={code}
          ownerId={ownerId}
          ownerName={ownerName}
          plan={plan}
          startAtCard={cardOnly}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
