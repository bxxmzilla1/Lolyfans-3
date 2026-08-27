"use client";

import { useRouter } from "next/navigation";

/**
 * "Message" action for a creator: opens the fan's private chat with them.
 * Only rendered when this fan already has a chat with the creator.
 */
export default function MessageCreatorButton({
  className,
}: {
  ownerId?: string;
  className?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.push("/chat")}
      className={className}
    >
      Message
    </button>
  );
}
