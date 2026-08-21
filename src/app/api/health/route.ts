import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Supabase connectivity check — used after credential/project changes to see
 * exactly what works and what's missing. Exposes only the project host (which
 * is public via NEXT_PUBLIC anyway), table ok/error states and counts.
 */

// Every table the app reads or writes. A missing one means schema.sql or a
// migration-*.sql was not run on the new project.
const TABLES = [
  "site_settings",
  "chats",
  "messages",
  "message_unlocks",
  "invites",
  "invite_visits",
  "invite_events",
  "vault_albums",
  "vault_items",
  "posts",
  "follows",
  "subscriptions",
];

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const report: Record<string, unknown> = {
    supabaseHost: url ? new URL(url).host : "MISSING NEXT_PUBLIC_SUPABASE_URL",
    serviceKeySet: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    anonKeySet: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };

  const db = supabaseAdmin();

  const tables: Record<string, string> = {};
  await Promise.all(
    TABLES.map(async (t) => {
      try {
        const { count, error } = await db
          .from(t)
          .select("*", { count: "exact", head: true });
        tables[t] = error ? `ERROR: ${error.message}` : `ok (${count} rows)`;
      } catch (e) {
        tables[t] = `ERROR: ${e instanceof Error ? e.message : "unknown"}`;
      }
    })
  );
  report.tables = tables;

  // Geo columns on invite_visits come from migration-invite-geo.sql.
  try {
    const { error } = await db
      .from("invite_visits")
      .select("city, region, org, last_seen_at")
      .limit(1);
    report.inviteGeoColumns = error ? `ERROR: ${error.message}` : "ok";
  } catch (e) {
    report.inviteGeoColumns = `ERROR: ${e instanceof Error ? e.message : "unknown"}`;
  }

  // All uploads, teasers and thumbnails live in the "media" bucket.
  try {
    const { data, error } = await db.storage.getBucket("media");
    report.mediaBucket = error
      ? `ERROR: ${error.message}`
      : data
        ? `ok (public: ${data.public})`
        : "MISSING";
  } catch (e) {
    report.mediaBucket = `ERROR: ${e instanceof Error ? e.message : "unknown"}`;
  }

  // Validates the service role key against the auth API and shows whether the
  // creator account exists on this project (0 users = sign-in impossible).
  try {
    const { data, error } = await db.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });
    report.auth = error
      ? `ERROR: ${error.message}`
      : `ok (${data.total ?? data.users.length} users)`;
  } catch (e) {
    report.auth = `ERROR: ${e instanceof Error ? e.message : "unknown"}`;
  }

  return NextResponse.json(report);
}
