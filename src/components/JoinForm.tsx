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
  );
}
