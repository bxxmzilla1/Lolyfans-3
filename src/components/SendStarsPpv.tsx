"use client";

import { useState } from "react";
import Portal from "./Portal";
import { VaultPicker, type VaultItem } from "./MassMessage";
import { IconStar } from "./Icons";
import { mediaUrl, thumbUrl } from "@/lib/utils";

type Msg = {
  id: string;
  sender: "owner" | "fan";
  content: string | null;
  media_path: string | null;
  media_type: string | null;
  locked: boolean;
  price_stars: number;
  status: string;
  unlock_id: string | null;
  created_at: string;
};

export default function SendStarsPpv({
  chatId,
  initial,
  onClose,
  onSent,
}: {
  chatId: string;
  /** Pre-picked media (e.g. dragged from the vault) — skips the picker. */
  initial?: Pick<VaultItem, "media_path" | "media_type"> | null;
  onClose: () => void;
  onSent: (msg: Msg) => void;
}) {
  const [pick, setPick] = useState<Pick<
    VaultItem,
    "media_path" | "media_type"
  > | null>(initial ?? null);
  const [picking, setPicking] = useState(!initial);
  const [stars, setStars] = useState("50");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const priceStars = Math.round(Number(stars)) || 0;

  async function send() {
    if (!pick || busy) return;
    if (priceStars < 1) {
      setError("Enter at least 1 Star (or use free send from vault later)");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/stars/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          mediaPath: pick.media_path,
          mediaType: pick.media_type,
          priceStars,
          content: caption.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not send");
        return;
      }
      onSent(data.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="w-full max-w-md bg-card border border-line rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[90dvh] flex flex-col relative">
          {picking ? (
            <div className="h-[70dvh] relative">
              <VaultPicker
                onPick={(item) => {
                  setPick(item);
                  setPicking(false);
                }}
                onClose={onClose}
              />
            </div>
          ) : (
            <>
              <header className="px-4 py-3 border-b border-line flex items-center justify-between">
                <p className="font-bold flex items-center gap-2">
                  <IconStar className="w-4 h-4 text-amber-400" />
                  Send for Stars
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-muted text-sm"
                >
                  Cancel
                </button>
              </header>
              <div className="p-4 space-y-3 overflow-y-auto">
                {pick && (
                  <div className="rounded-xl overflow-hidden border border-line">
                    {pick.media_type === "video" ? (
                      <video
                        src={mediaUrl(pick.media_path)}
                        className="w-full max-h-48 object-cover"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbUrl(pick.media_path)}
                        alt=""
                        className="w-full max-h-48 object-cover"
                      />
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  className="text-xs text-accent font-semibold"
                >
                  Change media
                </button>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">
                    Price in Stars <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={stars}
                    onChange={(e) => setStars(e.target.value)}
                    className="w-full rounded-xl border border-line bg-card2 px-3.5 py-2.5 text-sm outline-none focus:border-amber-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Caption</label>
                  <textarea
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    rows={2}
                    maxLength={300}
                    className="w-full rounded-xl border border-line bg-card2 px-3.5 py-2.5 text-sm outline-none focus:border-accent resize-none"
                  />
                </div>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={busy || !pick || priceStars < 1}
                  className="w-full rounded-xl bg-amber-500 text-black font-bold py-3 text-sm disabled:opacity-50"
                >
                  {busy ? "Sending…" : `Send · ${priceStars} Stars`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
}
