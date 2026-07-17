"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JoinForm({ code }: { code: string }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name }),
    });
    setLoading(false);
    if (res.ok) {
      router.push("/chat");
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error || "Could not join this chat");
    }
  }

  return (
    <form onSubmit={submit} className="w-full flex flex-col gap-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        maxLength={40}
        className="w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent transition-colors"
      />
      {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      <button
        type="submit"
        disabled={loading || !name.trim()}
        className="w-full bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-40 active:opacity-80 transition-opacity"
      >
        {loading ? "Joining…" : "Start chatting"}
      </button>
    </form>
  );
}
