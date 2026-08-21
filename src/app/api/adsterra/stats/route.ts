import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { adsterraFetch, getAdsterraToken } from "@/lib/adsterra";

const GROUPS = new Set(["date", "placement", "domain", "country"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type RawItem = Record<string, unknown>;

/** One normalized stats row for the dashboard. */
export type AdsterraRow = {
  /** Group label: the date, placement name, domain or country. */
  label: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  revenue: number;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Adsterra items use slightly different keys per grouping — normalize them. */
function normalize(item: RawItem, groupBy: string): AdsterraRow {
  const label = String(
    item[groupBy] ??
      item.date ??
      item.placement ??
      item.placement_name ??
      item.domain ??
      item.country ??
      ""
  );
  return {
    label,
    impressions: num(item.impression ?? item.impressions),
    clicks: num(item.clicks ?? item.click),
    ctr: num(item.ctr),
    cpm: num(item.cpm),
    revenue: num(item.revenue),
  };
}

/**
 * Adsterra stats proxy: the dashboard asks for a date range + grouping; we
 * call the Publishers API with the creator's saved token server-side.
 */
export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await getAdsterraToken(ownerId);
  if (!token) {
    return NextResponse.json({ error: "No Adsterra token" }, { status: 400 });
  }

  const q = req.nextUrl.searchParams;
  const start = q.get("start_date") || "";
  const finish = q.get("finish_date") || "";
  const groupBy = q.get("group_by") || "date";
  if (!DATE_RE.test(start) || !DATE_RE.test(finish)) {
    return NextResponse.json({ error: "Bad date range" }, { status: 400 });
  }
  if (!GROUPS.has(groupBy)) {
    return NextResponse.json({ error: "Bad group_by" }, { status: 400 });
  }

  const path =
    `stats.json?start_date=${start}&finish_date=${finish}` +
    `&group_by=${groupBy}`;
  const res = await adsterraFetch(token, path).catch(() => null);
  if (!res) {
    return NextResponse.json(
      { error: "Could not reach Adsterra — try again" },
      { status: 502 }
    );
  }
  if (!res.ok) {
    return NextResponse.json(
      {
        error:
          res.status === 401 || res.status === 403
            ? "Adsterra rejected the saved token — reconnect it"
            : `Adsterra error (HTTP ${res.status})`,
      },
      { status: 502 }
    );
  }

  const body = res.body as { items?: RawItem[] } | RawItem[] | null;
  const items = Array.isArray(body) ? body : body?.items ?? [];
  const rows = items.map((item) => normalize(item, groupBy));

  return NextResponse.json({ rows });
}
