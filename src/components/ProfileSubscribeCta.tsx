"use client";

import { useState } from "react";
import { JoinChannelSheet } from "./InviteSubscribeCta";
import { subButtonLabels, subCaption, type SubPlan } from "@/lib/subscriptionPlan";

/**
 * Profile-page "SUBSCRIBE" bar. Visitors get the Phantom sign-up sheet (then
 * the USDC step on paid profiles). Fans who signed up but owe the current
 * period (`payOnly`) reopen straight at the payment step.
 */
export default function ProfileSubscribeCta({
  code,
  ownerId,
  ownerName,
  plan,
  payOnly = false,
  chargeCents,
  autoOpen = false,
}: {
  code: string;
  ownerId: string;
  ownerName?: string;
  plan?: SubPlan | null;
  payOnly?: boolean;
  chargeCents?: number | null;
  /** Open the sheet on load (e.g. arriving via ?subscribe=1). */
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const paid = !!plan && plan.priceCents > 0;
  const caption = paid && plan ? subCaption(plan) : null;
  const labels = plan ? subButtonLabels(plan) : { left: "SUBSCRIBE", right: "FREE" };

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full px-5 py-3 rounded-full bg-accent text-white text-sm font-semibold active:opacity-80 transition-opacity flex items-center justify-between"
      >
        <span>{payOnly ? "CONTINUE" : labels.left}</span>
        <span>{labels.right}</span>
      </button>
      {caption && <p className="text-xs text-muted text-center">{caption}</p>}

      {open && (
        <JoinChannelSheet
          code={code}
          ownerId={ownerId}
          ownerName={ownerName}
          plan={plan}
          startAtPay={payOnly}
          chargeCents={chargeCents}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
