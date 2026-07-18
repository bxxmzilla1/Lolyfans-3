"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconCheck, IconUser } from "./Icons";
import { countryFlag, countryName } from "./CountryPicker";
import { DIAL_CODES } from "@/lib/dialCodes";

type Step = "form" | "code" | "waiting" | "accepted";

const COUNTRY_OPTIONS: { code: string; name: string; dial: string }[] = Object.keys(
  DIAL_CODES
)
  .map((code) => ({ code, name: countryName(code), dial: DIAL_CODES[code] }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Dial code -> countries sharing it (e.g. +1 is US, Canada and more).
const DIAL_TO_COUNTRIES: Record<string, string[]> = {};
for (const [iso, dial] of Object.entries(DIAL_CODES)) {
  (DIAL_TO_COUNTRIES[dial] ??= []).push(iso);
}

// Which country wins when several share a dial code and none is selected.
const DIAL_PREFERRED: Record<string, string> = {
  "1": "US", "7": "RU", "44": "GB", "47": "NO", "61": "AU", "212": "MA",
  "262": "RE", "358": "FI", "590": "GP", "599": "CW",
};

/**
 * Detects the country from a number typed with its dial code ("+63912…" or
 * "0063912…"). Returns the matched country plus the rest of the number, or
 * null when there's no usable match (yet).
 */
function detectCountry(
  raw: string,
  currentCountry: string
): { country: string; national: string } | null {
  const trimmed = raw.trim();
  let digits = "";
  if (trimmed.startsWith("+")) digits = trimmed.slice(1).replace(/\D/g, "");
  else if (/^00\d/.test(trimmed.replace(/\D/g, ""))) {
    digits = trimmed.replace(/\D/g, "").slice(2);
  } else return null;
  if (!digits) return null;

  // Longest dial code first (up to 3 digits) so "+1876" doesn't stop at "+1".
  for (let len = Math.min(3, digits.length); len >= 1; len--) {
    const dial = digits.slice(0, len);
    const countries = DIAL_TO_COUNTRIES[dial];
    if (!countries) continue;
    const country = countries.includes(currentCountry)
      ? currentCountry
      : DIAL_PREFERRED[dial] || countries[0];
    return { country, national: digits.slice(len) };
  }
  return null;
}

export default function JoinForm({
  code,
  buttonText,
  inviterName,
  avatarUrl,
  defaultCountry,
}: {
  code: string;
  buttonText?: string;
  inviterName: string;
  avatarUrl: string | null;
  defaultCountry?: string | null;
}) {
  const [step, setStep] = useState<Step>("form");
  const [country, setCountry] = useState(
    defaultCountry && DIAL_CODES[defaultCountry] ? defaultCountry : "US"
  );
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const router = useRouter();

  // Full number in E.164: +<dial><national number without leading zeros>.
  // A number still typed with "+" (dial code not recognized yet) is used as-is.
  const e164 = useMemo(() => {
    if (phone.trim().startsWith("+")) {
      const digits = phone.replace(/\D/g, "");
      return digits ? `+${digits}` : "";
    }
    const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
    return digits ? `+${DIAL_CODES[country]}${digits}` : "";
  }, [country, phone]);

  function startResendCooldown() {
    setResendIn(30);
    const tick = () => {
      setResendIn((s) => {
        if (s <= 1) return 0;
        timersRef.current.push(setTimeout(tick, 1000));
        return s - 1;
      });
    };
    timersRef.current.push(setTimeout(tick, 1000));
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    if (!/^\+[1-9]\d{6,14}$/.test(e164)) {
      setError("Enter a valid phone number");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/verify/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, phone: e164 }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error || "Couldn't send the verification code");
      return;
    }
    setOtp("");
    setStep("code");
    startResendCooldown();
  }

  async function verifyAndJoin(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!/^\d{4,10}$/.test(otp.trim())) {
      setError("Enter the code from the SMS");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, phone: e164, password, otp: otp.trim() }),
    });
    if (!res.ok) {
      setBusy(false);
      const data = await res.json().catch(() => null);
      setError(data?.error || "Could not join this chat");
      return;
    }

    // Verified — play the chat request sequence, then enter the chat.
    setStep("waiting");
    const waitMs = 2000 + Math.random() * 500; // 2-2.5s
    timersRef.current.push(
      setTimeout(() => {
        setStep("accepted");
        timersRef.current.push(
          setTimeout(() => {
            router.push("/chat");
            router.refresh();
          }, 1500)
        );
      }, waitMs)
    );
  }

  const avatar = avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarUrl}
      alt={inviterName}
      className="w-24 h-24 rounded-full object-cover bg-bg"
    />
  ) : (
    <div className="w-24 h-24 rounded-full bg-bg flex items-center justify-center">
      <IconUser className="w-10 h-10 text-muted" />
    </div>
  );

  const inputClass =
    "w-full bg-card2 border border-line rounded-xl px-4 py-3 text-[15px] placeholder:text-muted focus:border-accent transition-colors";

  return (
    <>
      {step === "form" && (
        <form onSubmit={sendCode} className="w-full flex flex-col gap-3">
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={inputClass}
            aria-label="Phone country"
          >
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {countryFlag(c.code)} {c.name} (+{c.dial})
              </option>
            ))}
          </select>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => {
              const v = e.target.value;
              // Typed with the dial code ("+63…" / "0063…")? Switch the
              // country automatically and keep only the local part. Getting
              // it wrong is fine — the picker above still overrides it.
              const detected = detectCountry(v, country);
              if (detected) {
                setCountry(detected.country);
                setPhone(detected.national);
              } else {
                setPhone(v);
              }
            }}
            placeholder="Phone number"
            className={inputClass}
          />
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Create a password"
            minLength={6}
            className={inputClass}
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={busy || !phone.trim() || password.length < 6}
            className="w-full bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-40 active:opacity-80 transition-opacity"
          >
            {busy ? "Sending code…" : buttonText?.trim() || "Start chatting"}
          </button>
          <p className="text-muted text-xs text-center">
            We&apos;ll text a verification code to your number.
          </p>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verifyAndJoin} className="w-full flex flex-col gap-3">
          <p className="text-muted text-sm text-center">
            Enter the code we texted to{" "}
            <span className="text-fg font-medium">{e164}</span>
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            placeholder="Verification code"
            maxLength={10}
            className={`${inputClass} text-center tracking-[0.3em]`}
            autoFocus
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={busy || otp.trim().length < 4}
            className="w-full bg-accent text-white font-semibold rounded-xl py-3 disabled:opacity-40 active:opacity-80 transition-opacity"
          >
            {busy ? "Verifying…" : "Verify & start chatting"}
          </button>
          <div className="flex items-center justify-center gap-4 text-sm">
            <button
              type="button"
              onClick={() => {
                setStep("form");
                setError("");
              }}
              className="text-muted hover:text-fg transition-colors"
            >
              Change number
            </button>
            <button
              type="button"
              disabled={busy || resendIn > 0}
              onClick={() => sendCode()}
              className="text-accent disabled:opacity-40"
            >
              {resendIn > 0 ? `Resend code (${resendIn}s)` : "Resend code"}
            </button>
          </div>
        </form>
      )}

      {(step === "waiting" || step === "accepted") && (
        <div className="fixed inset-0 z-50 bg-bg flex flex-col items-center justify-center gap-7 p-6">
          <div className="relative w-32 h-32 flex items-center justify-center">
            {step === "waiting" && (
              <>
                <span className="absolute inset-0 rounded-full bg-accent/25 animate-ping" />
                <span className="absolute inset-3 rounded-full bg-accent/15 animate-ping [animation-delay:400ms]" />
              </>
            )}
            <div className="ig-ring relative z-10">{avatar}</div>
            {step === "accepted" && (
              <span className="absolute bottom-0 right-0 z-20 w-9 h-9 rounded-full bg-green-500 border-4 border-bg flex items-center justify-center fade-up">
                <IconCheck className="w-4 h-4 text-white" />
              </span>
            )}
          </div>

          <div className="text-center">
            {step === "waiting" ? (
              <>
                <p className="font-bold text-lg">Chat request sent</p>
                <p className="text-muted text-sm mt-1.5">
                  Waiting for {inviterName} to accept
                </p>
                <span className="mt-3 inline-flex items-center gap-1">
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent" />
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent" />
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-accent" />
                </span>
              </>
            ) : (
              <>
                <p className="font-bold text-lg text-green-400 fade-up">
                  {inviterName} accepted your request
                </p>
                <p className="text-muted text-sm mt-1.5">Opening chat…</p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
