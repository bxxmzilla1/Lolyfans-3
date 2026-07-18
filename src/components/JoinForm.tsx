"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconCheck, IconUser } from "./Icons";

type Stage = "idle" | "waiting" | "accepted";

export default function JoinForm({
  code,
  buttonText,
  inviterName,
  avatarUrl,
}: {
  code: string;
  buttonText?: string;
  inviterName: string;
  avatarUrl: string | null;
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    // Show the request overlay right away so the button label never changes
    // (swapping its text mid-press glitches in some in-app browsers).
    setStage("waiting");
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      setLoading(false);
      setStage("idle");
      const data = await res.json().catch(() => null);
      setError(data?.error || "Could not join this chat");
      return;
    }

    // Chat request sequence: wait for the inviter to "respond", then enter.
    const waitMs = 2000 + Math.random() * 500; // 2-2.5s
    timersRef.current.push(
      setTimeout(() => {
        setStage("accepted");
        timersRef.current.push(
          setTimeout(() => {
            router.push("/chat");
            router.refresh();
          }, 1500)
        );
      }, waitMs)
    );
  }

  const avatar = avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarUrl}
      alt={inviterName}
      className="w-24 h-24 rounded-full object-cover bg-bg"
    />
  ) : (
    <div className="w-24 h-24 rounded-full bg-bg flex items-center justify-center">
      <IconUser className="w-10 h-10 text-muted" />
    </div>
  );

  return (
    <>
      <form onSubmit={submit} className="w-full flex flex-col gap-3">
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-40 active:opacity-80 transition-opacity"
        >
          {buttonText?.trim() || "Start chatting"}
        </button>
      </form>

      {stage !== "idle" && (
        <div className="fixed inset-0 z-50 bg-bg flex flex-col items-center justify-center gap-7 p-6">
          <div className="relative w-32 h-32 flex items-center justify-center">
            {stage === "waiting" && (
              <>
                <span className="absolute inset-0 rounded-full bg-accent/25 animate-ping" />
                <span className="absolute inset-3 rounded-full bg-accent/15 animate-ping [animation-delay:400ms]" />
              </>
            )}
            <div className="ig-ring relative z-10">{avatar}</div>
            {stage === "accepted" && (
              <span className="absolute bottom-0 right-0 z-20 w-9 h-9 rounded-full bg-green-500 border-4 border-bg flex items-center justify-center fade-up">
                <IconCheck className="w-4 h-4 text-white" />
              </span>
            )}
          </div>

          <div className="text-center">
            {stage === "waiting" ? (
              <>
                <p className="font-bold text-lg">Chat request sent</p>
                <p className="text-muted text-sm mt-1.5">
                  Waiting for {inviterName} to accept
                </p>
                <span className="mt-3 inline-flex items-center gap-1">
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent" />
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent" />
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent" />
                </span>
              </>
            ) : (
              <>
                <p className="font-bold text-lg text-green-400 fade-up">
                  {inviterName} accepted your request
                </p>
                <p className="text-muted text-sm mt-1.5">Opening chat…</p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
