import { ipFromHeaders } from "@/lib/invites";

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

type GeoParts = {
  city: string | null;
  country: string | null;
  /** Raw ISO 3166-1 alpha-2 code (e.g. "PH"), for forms that need a code. */
  countryCode: string | null;
};

// Warm serverless instances answer repeat lookups (same guest reloading the
// chat) instantly instead of hitting ipinfo every time.
const geoCache = new Map<string, GeoParts>();

async function ipinfoLookup(ip: string): Promise<GeoParts | null> {
  const cached = geoCache.get(ip);
  if (cached) return cached;
  try {
    const token = process.env.IPINFO_TOKEN;
    const url = `https://ipinfo.io/${ip}/json${token ? `?token=${token}` : ""}`;
    // Short timeout: a slow ipinfo response must not hold the page hostage.
    const res = await fetch(url, { signal: AbortSignal.timeout(1200), cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { city?: string; country?: string };
      if (data.city || data.country) {
        const parts: GeoParts = {
          city: data.city || null,
          country: data.country ? countryName(data.country) : null,
          countryCode: data.country ? data.country.toUpperCase() : null,
        };
        if (geoCache.size > 5000) geoCache.clear();
        geoCache.set(ip, parts);
        return parts;
      }
    }
  } catch {
    // ipinfo unreachable, rate limited, or timed out
  }
  return null;
}

/**
 * "City, Country" for a given IP via ipinfo.io. Returns null when it can't be
 * resolved (no IP, private/localhost address, or ipinfo unreachable).
 */
export async function locationFromIp(ip: string | null): Promise<string | null> {
  if (!ip) return null;
  const parts = await ipinfoLookup(ip);
  if (parts?.city && parts.country) return `${parts.city}, ${parts.country}`;
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
export async function visitorGeoParts(h: Headers): Promise<GeoParts> {
  const ip = ipFromHeaders(h);
  if (ip) {
    const parts = await ipinfoLookup(ip);
    if (parts) return parts;
  }
  const city = h.get("x-vercel-ip-city");
  const country = h.get("x-vercel-ip-country");
  return {
    city: city ? decodeURIComponent(city) : null,
    country: country ? countryName(country) : null,
    countryCode: country ? country.toUpperCase() : null,
  };
}

/**
 * Profile-bio tokens: CITYUSER → the visitor's city, COUNTRYUSER → their
 * country (via ipinfo). Each visitor reads the bio as if it were written
 * about their own location.
 */
export function applyUserGeoTokens(text: string, geo: GeoParts): string {
  return text
    .replace(/COUNTRYUSER/g, geo.country || "your country")
    .replace(/CITYUSER/g, geo.city || "your city");
}

/**
 * The visitor's ISO country code ("PH") via ipinfo, falling back to Vercel's
 * geo header — used to pre-select the country in embedded payment forms.
 */
export async function visitorCountryCode(h: Headers): Promise<string | null> {
  const ip = ipFromHeaders(h);
  if (ip) {
    const parts = await ipinfoLookup(ip);
    if (parts?.countryCode) return parts.countryCode;
  }
  const header = h.get("x-vercel-ip-country");
  return header ? header.toUpperCase() : null;
}
