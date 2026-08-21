"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Settings → Ad Settings: gate profile/feed videos behind Adsterra ad clicks.
 * The creator sets how many ad clicks unlock a video, how long each unlocked
 * part plays (minutes + seconds), and how many clicks each next part costs.
 * Stored in the creator's auth metadata; read server-side for public pages.
 */
export default function AdSettings() {
  const [clicks, setClicks] = useState("0");
  const [minutes, setMinutes] = useState("0");
  const [seconds, setSeconds] = useState("0");
  const [segmentClicks, setSegmentClicks] = useState("");
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
        const c = Math.max(0, Math.floor(Number(meta.ad_gate_clicks) || 0));
        const secs = Math.max(
          0,
          Math.floor(Number(meta.ad_gate_segment_secs) || 0)
        );
        const sc = Math.max(0, Math.floor(Number(meta.ad_gate_segment_clicks) || 0));
        setClicks(String(c));
        setMinutes(String(Math.floor(secs / 60)));
        setSeconds(String(secs % 60));
        setSegmentClicks(sc > 0 ? String(sc) : "");
        setLink(String(meta.ad_gate_link ?? ""));
      });
  }, []);

  const nClicks = Math.max(0, Math.floor(Number(clicks) || 0));
  const nSegmentSecs =
    Math.max(0, Math.floor(Number(minutes) || 0)) * 60 +
    Math.max(0, Math.min(59, Math.floor(Number(seconds) || 0)));
  const nSegmentClicks = Math.max(0, Math.floor(Number(segmentClicks) || 0));
  const enabled = nClicks > 0;

  async function save() {
    if (saving) return;
    const trimmedLink = link.trim();
    if (enabled && trimmedLink && !/^https?:\/\//i.test(trimmedLink)) {
      setError("The ad link must start with https://");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await supabaseBrowser().auth.updateUser({
        data: {
          ad_gate_clicks: nClicks,
          ad_gate_segment_secs: nSegmentSecs,
          ad_gate_segment_clicks: nSegmentClicks,
          ad_gate_link: trimmedLink,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none";

  return (
    <div className="space-y-5 max-w-lg">
      <div className="rounded-2xl border border-line bg-card p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold">Ad-click video unlock</p>
          <p className="text-xs text-muted mt-1">
            Visitors must click your Adsterra ads to watch videos on your
            profile and the home feed. Set the clicks to 0 to turn this off.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold">
            Ad clicks to unlock a video
          </label>
          <input
            type="number"
            min={0}
            value={clicks}
            onChange={(e) => setClicks(e.target.value)}
            className={`${inputClass} w-full`}
          />
          <p className="text-[11px] text-muted">
            0 = videos play freely with no ad gate.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold">
            Unlocked playback time (until the next unlock)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className={`${inputClass} w-24`}
              aria-label="Minutes"
            />
            <span className="text-xs text-muted">min</span>
            <input
              type="number"
              min={0}
              max={59}
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
              className={`${inputClass} w-24`}
              aria-label="Seconds"
            />
            <span className="text-xs text-muted">sec</span>
          </div>
          <p className="text-[11px] text-muted">
            After this much playback the video locks again until they click
            more ads. 0m 0s = the first unlock opens the whole video.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold">
            Ad clicks for each next part
          </label>
          <input
            type="number"
            min={0}
            value={segmentClicks}
            onChange={(e) => setSegmentClicks(e.target.value)}
            placeholder={`Same as first unlock${nClicks > 0 ? ` (${nClicks})` : ""}`}
            className={`${inputClass} w-full`}
          />
          <p className="text-[11px] text-muted">
            Leave empty to charge the same number of clicks every time.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold">
            Adsterra ad link (opened on every click)
          </label>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://www.effectivecpmnetwork.com/..."
            className={`${inputClass} w-full font-mono text-xs`}
          />
          <p className="text-[11px] text-muted">
            Paste an Adsterra <b>Direct Link</b> (Adsterra → Websites → add a
            Direct Link ad unit and copy its URL). Each unlock click opens it
            in a new tab, so every click earns. Without it, clicks still count
            but only fire the popunder scripts already on the page.
          </p>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={() => void save()}
          disabled={saving}
          className="w-full bg-accent text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
        >
          {saved ? "Saved!" : saving ? "Saving…" : "Save ad settings"}
        </button>
      </div>

      {enabled && (
        <div className="rounded-2xl border border-line bg-card2 p-4 text-xs text-muted space-y-1">
          <p className="font-semibold text-fg text-sm">How it works now</p>
          <p>
            Every video starts locked — visitors click {nClicks} ad
            {nClicks === 1 ? "" : "s"} to start watching.
          </p>
          {nSegmentSecs > 0 ? (
            <p>
              After {Math.floor(nSegmentSecs / 60)}m {nSegmentSecs % 60}s of
              playback it locks again, and each next part costs{" "}
              {nSegmentClicks || nClicks} click
              {(nSegmentClicks || nClicks) === 1 ? "" : "s"}.
            </p>
          ) : (
            <p>The first unlock opens the whole video.</p>
          )}
        </div>
      )}
    </div>
  );
}
