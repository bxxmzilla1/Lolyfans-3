import { ipFromHeaders } from "@/lib/invites";

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/**
 * The visitor's "City, Country" via ipinfo.io, falling back to Vercel's geo
 * headers. Returns null when the location can't be determined (e.g. localhost).
 */
export async function visitorLocation(h: Headers): Promise<string | null> {
  const ip = ipFromHeaders(h);
  try {
    const token = process.env.IPINFO_TOKEN;
    const url = `https://ipinfo.io/${ip ? `${ip}/` : ""}json${token ? `?token=${token}` : ""}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { city?: string; country?: string };
      if (data.city && data.country) {
        return `${data.city}, ${countryName(data.country)}`;
      }
    }
  } catch {
    // ipinfo unreachable or rate limited; use the header fallback below
  }
  const city = h.get("x-vercel-ip-city");
  const country = h.get("x-vercel-ip-country");
  if (city && country) {
    return `${decodeURIComponent(city)}, ${countryName(country)}`;
  }
  return null;
}
