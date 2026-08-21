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
      });
  }, []);

  const nClicks = Math.max(0, Math.floor(Number(clicks) || 0));
  const nSegmentSecs =
    Math.max(0, Math.floor(Number(minutes) || 0)) * 60 +
    Math.max(0, Math.min(59, Math.floor(Number(seconds) || 0)));
  const nSegmentClicks = Math.max(0, Math.floor(Number(segmentClicks) || 0));
  // Active with clicks up front, or with a timed re-lock even at 0 clicks
  // (first part free, later parts charge).
  const effectiveSegmentClicks = nSegmentClicks || nClicks;
  const enabled =
    nClicks > 0 || (nSegmentSecs > 0 && effectiveSegmentClicks > 0);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await supabaseBrowser().auth.updateUser({
        data: {
          ad_gate_clicks: nClicks,
          ad_gate_segment_secs: nSegmentSecs,
          ad_gate_segment_clicks: nSegmentClicks,
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
            Visitors unlock videos by tapping the Adsterra ads shown on the
            page (banners and native units). Everything at 0 turns this off.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold">
            Ad taps to unlock a video
          </label>
          <input
            type="number"
            min={0}
            value={clicks}
            onChange={(e) => setClicks(e.target.value)}
            className={`${inputClass} w-full`}
          />
          <p className="text-[11px] text-muted">
            How many ads on the page they must tap before the video plays.
            0 = the video starts playing free — but it still locks after the
            playback time below, and the next parts charge taps.
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
            After this much playback the video locks again until they tap
            more ads. 0m 0s = the first unlock opens the whole video.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold">
            Ad taps for each next part
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
            Leave empty to charge the same number of taps every time.
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
          {nClicks > 0 ? (
            <p>
              Every video starts locked — visitors tap {nClicks} ad
              {nClicks === 1 ? "" : "s"} on the page to start watching.
            </p>
          ) : (
            <p>Every video starts playing free.</p>
          )}
          {nSegmentSecs > 0 ? (
            <p>
              After {Math.floor(nSegmentSecs / 60)}m {nSegmentSecs % 60}s of
              playback it locks, and each next part costs{" "}
              {effectiveSegmentClicks} tap
              {effectiveSegmentClicks === 1 ? "" : "s"}.
            </p>
          ) : nClicks > 0 ? (
            <p>The first unlock opens the whole video.</p>
          ) : null}
          <p>
            Only real taps on the ad units (banners and the native block)
            count — taps elsewhere on the page don&apos;t.
          </p>
        </div>
      )}
    </div>
  );
}
