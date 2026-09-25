"use client";

import type { SubPlan } from "@/lib/subscriptionPlan";
import { WalletJoinFlow } from "./InviteSubscribeCta";

/**
 * Invite sign-up page: "Continue with Phantom". After join, the fan lands in
 * their private chat with the creator (paid profiles pay the first period
 * in USDC first).
 */
export default function JoinForm({
  code,
  buttonText,
  ownerId,
  ownerName,
  plan,
}: {
  code: string;
  buttonText?: string;
  ownerId: string;
  ownerName?: string;
  plan?: SubPlan | null;
}) {
  return (
    <div className="w-full">
      <WalletJoinFlow
        code={code}
        ownerId={ownerId}
        ownerName={ownerName}
        plan={plan}
        source="invite_signup"
        buttonText={buttonText}
      />
    </div>
  );
}
