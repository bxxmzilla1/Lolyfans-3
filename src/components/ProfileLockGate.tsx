"use client";

import { useState, type ReactNode } from "react";
import FollowButton from "./FollowButton";

/**
 * Client switch between the locked (blurred posts, no Message) and unlocked
 * profile views. Both views are rendered on the server and passed in — this
 * just flips between them the instant the subscribe button is toggled, so the
 * unblur/Message button doesn't wait for a server round-trip.
 */
export default function ProfileLockGate({
  ownerId,
  initialFollowing,
  canSubscribe,
  header,
  messageButton,
  lockedFeed,
  unlockedFeed,
}: {
  ownerId: string;
  initialFollowing: boolean;
  /** Guest has an account (chats) — otherwise no buttons are shown at all. */
  canSubscribe: boolean;
  header: ReactNode;
  messageButton: ReactNode;
  lockedFeed: ReactNode;
  unlockedFeed: ReactNode;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const locked = canSubscribe && !following;

  return (
    <>
      <section className="pb-4">
        {header}
        <div className="px-4 pt-3 flex flex-col items-center gap-3">
          {canSubscribe &&
            (locked ? (
              <>
                <FollowButton
                  key="locked"
                  ownerId={ownerId}
                  initialFollowing={false}
                  wide
                  onChange={setFollowing}
                />
                <p className="text-xs text-muted -mt-1">
                  You must subscribe to this profile to send a message
                </p>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <FollowButton
                  key="unlocked"
                  ownerId={ownerId}
                  initialFollowing={following}
                  onChange={setFollowing}
                />
                {messageButton}
              </div>
            ))}
        </div>
      </section>

      {locked ? lockedFeed : unlockedFeed}
    </>
  );
}
