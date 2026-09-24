"use client";

import { useState } from "react";
import { mediaUrl } from "@/lib/utils";
import { subCaption, type SubPlan } from "@/lib/subscriptionPlan";
import { JoinChannelSheet } from "./InviteSubscribeCta";
import { IconSend, IconUser, IconVerified } from "./Icons";

/**
 * What a visitor without an account sees when they open a creator: the
 * creator's chat, locked. The header and message box look like the real
 * chat and load without any popup; trying to write opens the sign-up sheet,
 * and finishing it drops them straight into the conversation.
 */
export default function CreatorChatPreview({
  ownerId,
  name,
  avatarPath,
  verified,
  intro,
  plan,
  inviteCode,
  cardOnly = false,
  autoOpen = false,
}: {
  ownerId: string;
  name: string;
  avatarPath: string | null;
  verified: boolean;
  /** The creator's opening line (bio, or a default greeting). */
  intro: string;
  /** The creator's subscription plan (price 0 = free). */
  plan: SubPlan;
  /** Active invite code to register with; null = not accepting new fans. */
  inviteCode: string | null;
  /** Fan already has an account here but no card yet (paid profile). */
  cardOnly?: boolean;
  /** Open the sheet on load (sent here by the paywall). */
  autoOpen?: boolean;
}) {
  // The chat shows first; the sign-up sheet only appears when they try to
  // talk (message box, send button or Start chatting) — unless the paywall
  // sent them here to add their card.
  const [open, setOpen] = useState(autoOpen);
  // The card step doesn't need an invite code; a fresh sign-up does.
  const canJoin = cardOnly || !!inviteCode;
  const paid = plan.priceCents > 0;
  const caption = subCaption(plan);
  const prompt = !canJoin
    ? `${name} isn't accepting new fans right now.`
    : cardOnly
      ? `Add your card to start chatting with ${name}.`
      : paid
        ? `Create your account and subscribe to start chatting with ${name}.`
        : `Create your free account to start chatting with ${name}.`;

  function openSheet() {
    if (canJoin) setOpen(true);
  }

  return (
    <div className="h-dvh flex flex-col lg:max-w-2xl lg:mx-auto lg:border-x lg:border-line">
      <header className="relative z-40 border-b border-line2 px-4 py-3 flex items-center gap-3 bg-card/60 backdrop-blur-lg">
        <div className="relative shrink-0">
          <div className="ig-ring">
            {avatarPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl(avatarPath)}
                alt={name}
                className="w-10 h-10 rounded-full object-cover bg-bg"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center">
                <IconUser className="w-5 h-5 text-muted" />
              </div>
            )}
          </div>
          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-bg bg-green-500" />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-[15px] leading-tight flex items-center gap-1">
            <span className="truncate">{name}</span>
            <IconVerified className="w-5 h-5 text-accent shrink-0" />
            {verified && (
              <span className="text-[10px] font-semibold text-accent shrink-0">
                ID Verified
              </span>
            )}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            Online now
          </p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        <div className="flex items-end gap-2 max-w-[85%]">
          {avatarPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl(avatarPath)}
              alt=""
              className="w-7 h-7 rounded-full object-cover bg-card2 shrink-0"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-card2 shrink-0" />
          )}
          <div className="rounded-2xl rounded-bl-md bg-card border border-line2 px-4 py-2.5 text-[15px] whitespace-pre-wrap break-words">
            {intro}
          </div>
        </div>

        <div className="pt-6 flex flex-col items-center text-center gap-3">
          <p className="text-sm text-muted max-w-xs">{prompt}</p>
          {canJoin && (
            <button
              type="button"
              onClick={openSheet}
              className="px-6 py-3 rounded-full bg-accent text-white text-sm font-semibold active:opacity-80 transition-opacity"
            >
              {cardOnly ? "Add your card" : paid ? "Subscribe" : "Start chatting"}
            </button>
          )}
          {canJoin && paid && caption && (
            <p className="text-xs text-muted">{caption}</p>
          )}
        </div>
      </main>

      {/* Locked message box: tapping it opens the sign-up sheet. */}
      <div className="border-t border-line2 bg-card/60 backdrop-blur-lg px-3 py-2 pb-[calc(8px+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={openSheet}
          disabled={!canJoin}
          className="w-full flex items-center gap-2 rounded-2xl bg-card2 border border-line px-3 py-1.5 text-left disabled:opacity-60"
          aria-label="Sign up to send a message"
        >
          <span className="flex-1 py-2 text-[15px] text-muted">Message…</span>
          <span className="w-9 h-9 rounded-xl bg-accent text-white shrink-0 flex items-center justify-center">
            <IconSend className="w-4.5 h-4.5" />
          </span>
        </button>
      </div>

      {open && canJoin && (
        <JoinChannelSheet
          code={inviteCode ?? ""}
          ownerId={ownerId}
          ownerName={name}
          plan={plan}
          startAtCard={cardOnly}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
