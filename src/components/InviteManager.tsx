"use client";

import { useEffect, useState } from "react";
import type { Invite } from "@/lib/invites";
import CountryPicker, { countryFlag, countryName } from "./CountryPicker";

export default function InviteManager() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [countries, setCountries] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/invites");
    if (res.ok) {
      const { invites } = await res.json();
      setInvites(invites);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    setCreating(true);
    const res = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, allowedCountries: countries }),
    });
    setCreating(false);
    if (res.ok) {
      setLabel("");
      setCountries([]);
      setShowForm(false);
      load();
    }
  }

  async function toggleActive(invite: Invite) {
    await fetch("/api/invites", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: invite.id, active: !invite.active }),
    });
    load();
  }

  async function remove(invite: Invite) {
    if (!confirm("Delete this invite link? Existing chats stay.")) return;
    await fetch("/api/invites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: invite.id }),
    });
    load();
  }

  function copy(invite: Invite) {
    const url = `${window.location.origin}/i/${invite.code}`;
    navigator.clipboard.writeText(url);
    setCopied(invite.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-4">
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full bg-accent text-white font-semibold rounded-xl py-3 active:opacity-80 transition-opacity"
        >
          + New invite link
        </button>
      ) : (
        <div className="bg-card border border-line rounded-2xl p-4 space-y-4 fade-up">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. Twitter bio)"
            className="w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent transition-colors"
          />

          <div>
            <p className="text-sm font-semibold mb-2">
              Countries allowed to chat with this link
            </p>
            <CountryPicker selected={countries} onChange={setCountries} />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="flex-1 bg-card2 border border-line rounded-xl py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={create}
              disabled={creating}
              className="flex-1 bg-accent text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
            >
              {creating ? "Creating…" : "Create link"}
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-3">
        {invites.map((invite) => (
          <li
            key={invite.id}
            className={`bg-card border border-line rounded-2xl p-4 ${
              invite.active ? "" : "opacity-50"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-[15px] truncate">
                {invite.label || "Invite link"}
              </p>
              <span className="text-xs text-muted shrink-0">
                {invite.uses} join{invite.uses === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-muted text-xs mt-0.5 break-all">/i/{invite.code}</p>
            {invite.allowed_countries && invite.allowed_countries.length > 0 ? (
              <p
                className="text-xs mt-1.5"
                title={invite.allowed_countries.map((c) => countryName(c)).join(", ")}
              >
                {invite.allowed_countries.map((c) => countryFlag(c)).join(" ")}{" "}
                <span className="text-muted">only</span>
              </p>
            ) : (
              <p className="text-xs mt-1.5 text-muted">🌍 Everyone</p>
            )}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => copy(invite)}
                className="flex-1 bg-accent text-white rounded-lg py-2 text-xs font-semibold"
              >
                {copied === invite.id ? "Copied!" : "Copy link"}
              </button>
              <button
                onClick={() => toggleActive(invite)}
                className="flex-1 bg-card2 border border-line rounded-lg py-2 text-xs font-semibold"
              >
                {invite.active ? "Disable" : "Enable"}
              </button>
              <button
                onClick={() => remove(invite)}
                className="px-3 bg-card2 border border-line rounded-lg py-2 text-xs font-semibold text-red-400"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
