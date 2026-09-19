"use client";

import { useCallback, useEffect, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Tiny shared "a navigation is in flight" counter. Anything that starts a
 * route change (tab taps, opening a chat, Message buttons) bumps it while the
 * transition is pending; NavLoadingOverlay fades in when it's > 0 so the app
 * never looks frozen between sections.
 */
let pending = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function beginNavPending() {
  pending += 1;
  emit();
}

export function endNavPending() {
  pending = Math.max(0, pending - 1);
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useNavPending(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => pending > 0,
    () => false
  );
}

/**
 * router.push wrapped in a transition that reports to the shared counter.
 * `run(asyncFn)` covers "fetch first, then navigate" flows the same way.
 */
export function useNavigate() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!isPending) return;
    beginNavPending();
    return () => endNavPending();
  }, [isPending]);

  const go = useCallback(
    (href: string) => {
      startTransition(() => {
        router.push(href);
      });
    },
    [router]
  );

  const replace = useCallback(
    (href: string) => {
      startTransition(() => {
        router.replace(href);
      });
    },
    [router]
  );

  /** Show the overlay while `work` runs, then navigate to what it returns. */
  const run = useCallback(
    async (work: () => Promise<string | null | undefined>) => {
      beginNavPending();
      try {
        const href = await work();
        if (href) go(href);
      } finally {
        endNavPending();
      }
    },
    [go]
  );

  return { go, replace, run, pending: isPending };
}
