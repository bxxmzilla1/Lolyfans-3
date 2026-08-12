import "server-only";

export type IpGeo = {
  country: string | null;
  region: string | null;
  city: string | null;
  /** ISP / network, e.g. "AS15169 Google LLC". */
  org: string | null;
};

function isPrivateIp(ip: string): boolean {
  return (
    /^(10\.|127\.|192\.168\.|169\.254\.)/.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip === "::1" ||
    ip.startsWith("fc") ||
    ip.startsWith("fd")
  );
}

/**
 * Geo-locate a visitor IP through ipinfo.io. Uses IPINFO_TOKEN when set
 * (higher limits); short timeout and null on any failure — lookups run
 * after the redirect response, so they must never throw.
 */
export async function lookupIp(ip: string): Promise<IpGeo | null> {
  if (!ip || isPrivateIp(ip)) return null;
  const token = (process.env.IPINFO_TOKEN || "").trim();
  const url = `https://ipinfo.io/${encodeURIComponent(ip)}/json${
    token ? `?token=${encodeURIComponent(token)}` : ""
  }`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      country?: string;
      region?: string;
      city?: string;
      org?: string;
    };
    return {
      country: (data.country || "").toUpperCase() || null,
      region: data.region || null,
      city: data.city || null,
      org: data.org || null,
    };
  } catch {
    return null;
  }
}
