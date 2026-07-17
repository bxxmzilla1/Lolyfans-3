"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JoinForm({
  code,
  buttonText,
}: {
  code: string;
  buttonText?: string;
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      setLoading(false);
      const data = await res.json().catch(() => null);
      setError(data?.error || "Could not join this chat");
      return;
    }
    router.push("/chat");
    router.refresh();
  }

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

      {/* Chat skeleton shown from the button press until /chat finishes loading,
          so the page never looks frozen. */}
      {loading && !error && (
        <div className="fixed inset-0 z-50 bg-bg flex flex-col fade-up">
          <div className="border-b border-line2 px-4 py-3 flex items-center gap-3 bg-card/60">
            <div className="w-11 h-11 rounded-full bg-card2 animate-pulse" />
            <div className="space-y-1.5">
              <div className="h-3 w-28 rounded-full bg-card2 animate-pulse" />
              <div className="h-2.5 w-16 rounded-full bg-card2 animate-pulse" />
            </div>
          </div>
          <div className="flex-1 p-4 space-y-3 overflow-hidden">
            <div className="h-10 w-44 rounded-3xl rounded-bl-lg bg-card2 animate-pulse" />
            <div className="h-10 w-56 rounded-3xl rounded-bl-lg bg-card2 animate-pulse" />
            <div className="h-10 w-40 rounded-3xl rounded-br-lg bg-accent/25 animate-pulse ml-auto" />
            <div className="h-10 w-52 rounded-3xl rounded-bl-lg bg-card2 animate-pulse" />
          </div>
          <div className="p-3">
            <div className="h-12 rounded-2xl bg-card2 border border-line animate-pulse" />
          </div>
          <p className="absolute inset-x-0 top-1/2 text-center text-muted text-sm">
            Opening chat…
          </p>
        </div>
      )}
    </>
  );
}
