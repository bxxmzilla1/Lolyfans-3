"use client";

import { useMemo, useState } from "react";

// All assigned ISO 3166-1 alpha-2 codes
const ALL_CODES = [
  "AD","AE","AF","AG","AI","AL","AM","AO","AR","AS","AT","AU","AW","AX","AZ",
  "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BM","BN","BO","BR","BS","BT","BW","BY","BZ",
  "CA","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CY","CZ",
  "DE","DJ","DK","DM","DO","DZ","EC","EE","EG","ER","ES","ET","FI","FJ","FK","FM","FO","FR",
  "GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GT","GU","GW","GY",
  "HK","HN","HR","HT","HU","ID","IE","IL","IM","IN","IQ","IR","IS","IT","JE","JM","JO","JP",
  "KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC","LI","LK","LR","LS",
  "LT","LU","LV","LY","MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ",
  "MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI","NL","NO","NP",
  "NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PL","PM","PR","PS","PT","PW","PY","QA",
  "RE","RO","RS","RU","RW","SA","SB","SC","SD","SE","SG","SI","SK","SL","SM","SN","SO","SR",
  "SS","ST","SV","SX","SY","SZ","TC","TD","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT",
  "TV","TW","TZ","UA","UG","US","UY","UZ","VC","VE","VG","VI","VN","VU","WF","WS","YE","YT",
  "ZA","ZM","ZW",
];

export function countryFlag(code: string): string {
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

const displayNames =
  typeof Intl !== "undefined" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

export function countryName(code: string): string {
  try {
    return displayNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

const COUNTRIES: [string, string][] = ALL_CODES.map(
  (code) => [code, countryName(code)] as [string, string]
).sort((a, b) => a[1].localeCompare(b[1]));

export default function CountryPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (codes: string[]) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      ([code, name]) => name.toLowerCase().includes(q) || code.toLowerCase() === q
    );
  }, [search]);

  function toggle(code: string) {
    onChange(
      selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]
    );
  }

  return (
    <div className="space-y-2">
      {selected.length === 0 ? (
        <p className="text-xs text-muted">
          🌍 Everyone can use this link. Select countries to allow only them.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((code) => (
            <button
              key={code}
              onClick={() => toggle(code)}
              className="px-2.5 py-1.5 rounded-full text-xs font-medium bg-accent text-white flex items-center gap-1"
            >
              {countryFlag(code)} {countryName(code)}
              <span className="opacity-80">✕</span>
            </button>
          ))}
          <button
            onClick={() => onChange([])}
            className="px-2.5 py-1.5 rounded-full text-xs font-medium bg-card2 border border-line text-muted"
          >
            Clear all
          </button>
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search countries…"
        className="w-full bg-card2 border border-line rounded-xl px-3 py-2 text-sm placeholder:text-muted focus:border-accent transition-colors"
      />

      <div className="max-h-48 overflow-y-auto rounded-xl border border-line bg-card2 divide-y divide-line/50">
        {filtered.map(([code, name]) => {
          const active = selected.includes(code);
          return (
            <button
              key={code}
              onClick={() => toggle(code)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                active ? "text-fg" : "text-muted hover:text-fg"
              }`}
            >
              <span className="text-base">{countryFlag(code)}</span>
              <span className="flex-1">{name}</span>
              <span
                className={`w-4.5 h-4.5 rounded-full border flex items-center justify-center text-[10px] ${
                  active ? "bg-accent border-accent text-white" : "border-line"
                }`}
              >
                {active ? "✓" : ""}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-3 py-3 text-sm text-muted">No countries found</p>
        )}
      </div>
    </div>
  );
}
