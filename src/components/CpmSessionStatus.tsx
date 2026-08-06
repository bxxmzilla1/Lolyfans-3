"use client";

import { useEffect, useState } from "react";
import {
  cpmEarnedCents,
  cpmSessionLive,
  formatCpmDollars,
} from "@/lib/cpmShared";

type Session = {
  startedAt: string;
  lastActiveAt: string;
  minutesCharged: number;
  live: boolean;
};

/**
 * Creator-only chat header: green "Active" + how much the fan is spending
 * this session ($1/min accrued). Never mounted on the guest /chat page —
 * the session API also requires an owner login.
 */
export default function CpmSessionStatus({ chatId }: { chatId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/cpm/session?chatId=${encodeURIComponent(chatId)}`
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setSession(res.ok ? (data.session as Session | null) : null);
      } catch {
        // next poll retries
      }
    };
    void load();
    const poll = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [chatId]);

  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session?.startedAt, !!session]);

  if (!session) {
    return (
      <span className="text-muted text-xs shrink-0">Idle</span>
    );
  }

  const live = cpmSessionLive(session.lastActiveAt, now) || session.live;
  // Live: tick with now (they're heartbeating). Idle settle uses last_active only.
  const earned = formatCpmDollars(
    cpmEarnedCents(
      session.startedAt,
      now,
      live ? null : session.lastActiveAt
    )
  );

  return (
    <span className="inline-flex items-center gap-1.5 text-xs shrink-0">
      <span
        className={`inline-flex items-center gap-1 font-semibold ${
          live ? "text-emerald-400" : "text-muted"
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            live ? "bg-emerald-400 animate-pulse" : "bg-muted"
          }`}
        />
        {live ? "Active" : "Idle"}
      </span>
      <span className="text-muted">·</span>
      <span
        className={`font-bold tabular-nums ${
          live ? "text-amber-300" : "text-muted"
        }`}
        title="What this fan is spending this session ($1/min)"
      >
        {earned}
      </span>
    </span>
  );
}
