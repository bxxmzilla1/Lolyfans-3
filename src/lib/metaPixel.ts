import { CENTS_PER_TOKEN } from "./tokens";

/** Meta (Facebook) Pixel id — base code is inlined in app/layout.tsx. */
export const META_PIXEL_ID = "1048828734453613";

/** Official base snippet: loads fbevents.js, inits the pixel, fires PageView. */
export const META_PIXEL_SNIPPET = `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');`;

type Fbq = (...args: unknown[]) => void;

declare global {
  interface Window {
    fbq?: Fbq;
  }
}

/** Fire a standard Pixel event; silently a no-op when the pixel is blocked. */
export function trackPixel(event: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    window.fbq?.("track", event, params);
  } catch {
    // ad blockers / privacy modes — never break the app over analytics
  }
}

/** Fan added a card for a paid profile (trial started or first charge). */
export function trackSubscribe(priceCents: number, trialDays: number) {
  trackPixel("Subscribe", {
    value: Number((priceCents / 100).toFixed(2)),
    currency: "USD",
    predicted_ltv: Number(((priceCents * 3) / 100).toFixed(2)),
    content_name: trialDays > 0 ? "free_trial" : "paid",
  });
}

/** Fan finished creating an account (not a returning login). */
export function trackSignup(source: string) {
  trackPixel("CompleteRegistration", { content_name: source, status: true });
}

/**
 * A lead, as the platform defines it: on a FREE creator chat, the moment a
 * new fan signs up; on a PAID / free-trial chat, the moment they've entered
 * and verified their card. Fired once per new account per creator.
 */
export function trackLead(plan: { priceCents: number; trialDays: number }, source: string) {
  trackPixel("Lead", {
    content_name:
      plan.priceCents <= 0 ? "free_chat" : plan.trialDays > 0 ? "paid_free_trial" : "paid",
    content_category: source,
    value: Number((plan.priceCents / 100).toFixed(2)),
    currency: "USD",
  });
}

/**
 * Fan bought a Token pack (real money). `amountCents` is what Stripe charged;
 * when a response lacks it, the pack's Token count gives the USD equivalent.
 */
export function trackTopup(opts: {
  amountCents?: number | null;
  tokens?: number | null;
  packId?: string | null;
  source: string;
}) {
  const cents =
    opts.amountCents && opts.amountCents > 0
      ? opts.amountCents
      : (opts.tokens ?? 0) * CENTS_PER_TOKEN;
  if (!(cents > 0)) return;
  trackPixel("Purchase", {
    value: Number((cents / 100).toFixed(2)),
    currency: "USD",
    content_type: "product",
    content_ids: [opts.packId || "tokens"],
    content_name: "Token top-up",
    content_category: opts.source,
    num_items: 1,
  });
}
