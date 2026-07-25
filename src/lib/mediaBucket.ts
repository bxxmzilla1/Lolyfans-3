import { supabaseAdmin } from "@/lib/supabase/admin";

let ensured: Promise<void> | null = null;

/**
 * Raise / clear the media bucket's per-bucket size cap so uploads aren't
 * blocked below the project's global Storage limit (set in the Supabase
 * dashboard → Storage → Settings). Safe to call on every upload; runs once.
 */
export function ensureMediaBucketLimits(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const db = supabaseAdmin();
      // Prefer creating with a high cap; ignore "already exists".
      await db.storage
        .createBucket("media", {
          public: true,
          fileSizeLimit: "50GB",
        })
        .catch(() => {});
      const { error } = await db.storage.updateBucket("media", {
        public: true,
        // null = no extra bucket cap (use the project global limit only)
        fileSizeLimit: null,
        // No mime restriction — chat media includes images, videos and
        // voice-note audio (a dashboard-set allowlist would reject audio).
        allowedMimeTypes: null,
      });
      if (error) {
        // Fallback: push the bucket cap as high as the API allows.
        await db.storage
          .updateBucket("media", {
            public: true,
            fileSizeLimit: "50GB",
            allowedMimeTypes: null,
          })
          .catch(() => {});
      }
    })().catch(() => {
      // Don't block uploads if bucket settings can't be changed.
      ensured = null;
    });
  }
  return ensured ?? Promise.resolve();
}
