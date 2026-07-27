"use client";

import { useMemo, useState } from "react";
import {
  CardCvcElement,
  CardExpiryElement,
  CardNumberElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { getStripe } from "@/lib/stripeClient";

/** ISO 3166-1 alpha-2 codes; names come from Intl.DisplayNames. */
const COUNTRY_CODES =
  "AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ES ET FI FJ FK FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GY HK HN HR HT HU ID IE IL IM IN IO IS IT JE JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV MA MC MD ME MF MG MK ML MM MN MO MQ MR MS MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NZ OM PA PE PF PG PH PK PL PM PR PT PW PY QA RE RO RS RW SA SB SC SE SG SH SI SJ SK SL SM SN SO SR ST SV SX SZ TC TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VC VE VG VI VN VU WF WS XK YE ZA ZM ZW".split(
    " "
  );

const STEP_TITLES = ["Card details", "Cardholder name", "Confirm & pay"];

function priceLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function CardWizard({
  clientSecret,
  amountCents,
  tokens,
  countryGuess,
  onSuccess,
  onCancel,
}: {
  clientSecret: string;
  amountCents: number;
  tokens: number;
  countryGuess: string | null;
  onSuccess: (paymentIntentId: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const [step, setStep] = useState(1);
  const [cardOk, setCardOk] = useState({ num: false, exp: false, cvc: false });
  const [name, setName] = useState("");
  const [country, setCountry] = useState(
    countryGuess && COUNTRY_CODES.includes(countryGuess) ? countryGuess : "US"
  );
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countries = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      // Very old browsers: codes only
    }
    return COUNTRY_CODES.map((code) => ({
      code,
      name: names?.of(code) ?? code,
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  // Style the split card fields with the site's CSS variables so they look
  // native to the current theme.
  const fieldStyle = useMemo(() => {
    const css =
      typeof window !== "undefined"
        ? getComputedStyle(document.documentElement)
        : null;
    const v = (nameVar: string, fallback: string) =>
      css?.getPropertyValue(nameVar).trim() || fallback;
    return {
      style: {
        base: {
          color: v("--fg", "#0f1419"),
          fontSize: "16px",
          fontFamily: "inherit",
          "::placeholder": { color: v("--muted", "#8b98a5") },
        },
        invalid: { color: "#ef4444" },
      },
    };
  }, []);

  async function pay() {
    if (!stripe || !elements || paying) return;
    const card = elements.getElement(CardNumberElement);
    if (!card) return;
    setPaying(true);
    setError(null);
    try {
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card,
          billing_details: { name: name.trim(), address: { country } },
        },
      });
      if (result.error) {
        setError(result.error.message || "Payment failed. Please try again.");
        setPaying(false);
        return;
      }
      if (result.paymentIntent?.status === "succeeded") {
        setDone(true);
        await onSuccess(result.paymentIntent.id);
        return;
      }
      setError("Payment did not complete. Please try again.");
      setPaying(false);
    } catch {
      setError("Payment failed. Please try again.");
      setPaying(false);
    }
  }

  const cardComplete = cardOk.num && cardOk.exp && cardOk.cvc;
  const fieldBox =
    "rounded-xl border border-line bg-card px-3 py-2.5 [&_.StripeElement]:w-full";

  return (
    <div className="rounded-2xl border border-accent/40 bg-card2/95 backdrop-blur p-3.5 space-y-3">
      {/* Header: what's being bought + progress */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold leading-tight">
            {tokens.toLocaleString("en-US")}{" "}
            <span className="text-xs font-semibold text-muted">Tokens</span>
          </p>
          <p className="text-[11px] text-muted leading-tight">
            Step {step} of 3 · {STEP_TITLES[step - 1]}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={paying}
          aria-label="Cancel payment"
          className="shrink-0 w-7 h-7 rounded-full bg-card border border-line text-muted flex items-center justify-center text-sm disabled:opacity-50"
        >
          ✕
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-line/60 overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${(step / 3) * 100}%` }}
        />
      </div>

      {/* Step 1: card fields. Kept mounted (hidden) on later steps so the
          entered card data survives navigating back and forth. */}
      <div className={step === 1 ? "space-y-2" : "hidden"}>
        <div className={fieldBox}>
          <CardNumberElement
            options={{ ...fieldStyle, showIcon: true }}
            onChange={(e) => setCardOk((s) => ({ ...s, num: e.complete }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className={fieldBox}>
            <CardExpiryElement
              options={fieldStyle}
              onChange={(e) => setCardOk((s) => ({ ...s, exp: e.complete }))}
            />
          </div>
          <div className={fieldBox}>
            <CardCvcElement
              options={fieldStyle}
              onChange={(e) => setCardOk((s) => ({ ...s, cvc: e.complete }))}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setStep(2)}
          disabled={!cardComplete}
          className="w-full rounded-xl bg-accent text-white text-sm font-bold py-2.5 disabled:opacity-50"
        >
          Next
        </button>
      </div>

      {/* Step 2: cardholder name */}
      {step === 2 && (
        <div className="space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name on card"
            autoComplete="cc-name"
            autoFocus
            className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-[15px]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 rounded-xl border border-line bg-card text-sm font-bold py-2.5"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!name.trim()}
              className="flex-[2] rounded-xl bg-accent text-white text-sm font-bold py-2.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 3: country (auto-detected) + pay */}
      {step === 3 && (
        <div className="space-y-2">
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            autoComplete="country"
            className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-[15px] appearance-none"
          >
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={paying}
              className="flex-1 rounded-xl border border-line bg-card text-sm font-bold py-2.5 disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={pay}
              disabled={paying || !stripe}
              className="flex-[2] rounded-xl bg-accent text-white text-sm font-bold py-2.5 disabled:opacity-60"
            >
              {done ? "Adding Tokens…" : paying ? "Processing…" : `Pay ${priceLabel(amountCents)}`}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs font-semibold text-red-500">{error}</p>}

      <p className="text-[10px] text-muted text-center">
        Secured by Stripe · Your card is saved for one-tap purchases
      </p>
    </div>
  );
}

/**
 * In-chat first purchase: the token pack bar and composer swap for this
 * 3-step card wizard (card → name → country + pay) with a progress bar, so
 * the fan never leaves the chat. The country is pre-selected from their IP.
 */
export default function EmbeddedCardTopup(props: {
  clientSecret: string;
  amountCents: number;
  tokens: number;
  countryGuess: string | null;
  onSuccess: (paymentIntentId: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  return (
    <Elements stripe={getStripe()}>
      <CardWizard {...props} />
    </Elements>
  );
}
