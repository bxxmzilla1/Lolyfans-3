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

/** Fan finished creating an account (not a returning login). */
export function trackSignup(source: string) {
  trackPixel("CompleteRegistration", { content_name: source, status: true });
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
