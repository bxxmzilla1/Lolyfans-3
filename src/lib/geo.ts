import { ipFromHeaders } from "@/lib/invites";

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/**
 * "City, Country" for a given IP via ipinfo.io. Returns null when it can't be
 * resolved (no IP, private/localhost address, or ipinfo unreachable).
 */
export async function locationFromIp(ip: string | null): Promise<string | null> {
  if (!ip) return null;
  try {
    const token = process.env.IPINFO_TOKEN;
    const url = `https://ipinfo.io/${ip}/json${token ? `?token=${token}` : ""}`;
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
    // ipinfo unreachable or rate limited
  }
  return null;
}

/**
 * The visitor's "City, Country" via ipinfo.io, falling back to Vercel's geo
 * headers. Returns null when the location can't be determined (e.g. localhost).
 */
export async function visitorLocation(h: Headers): Promise<string | null> {
  const fromIp = await locationFromIp(ipFromHeaders(h));
  if (fromIp) return fromIp;

  const city = h.get("x-vercel-ip-city");
  const country = h.get("x-vercel-ip-country");
  if (city && country) {
    return `${decodeURIComponent(city)}, ${countryName(country)}`;
  }
  return null;
}

/** Full country name for a 2-letter code, or null when the code is missing. */
export function fullCountryName(code: string | null | undefined): string | null {
  if (!code) return null;
  return countryName(code);
}

/**
 * Visitor's city and full country name as separate parts (for the CITY /
 * COUNTRY tokens in a custom invite description). Falls back to Vercel headers.
 */
export async function visitorGeoParts(
  h: Headers
): Promise<{ city: string | null; country: string | null }> {
  const ip = ipFromHeaders(h);
  if (ip) {
    try {
      const token = process.env.IPINFO_TOKEN;
      const url = `https://ipinfo.io/${ip}/json${token ? `?token=${token}` : ""}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2500), cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { city?: string; country?: string };
        if (data.city || data.country) {
          return {
            city: data.city || null,
            country: data.country ? countryName(data.country) : null,
          };
        }
      }
    } catch {
      // fall through to headers
    }
  }
  const city = h.get("x-vercel-ip-city");
  const country = h.get("x-vercel-ip-country");
  return {
    city: city ? decodeURIComponent(city) : null,
    country: country ? countryName(country) : null,
  };
}
