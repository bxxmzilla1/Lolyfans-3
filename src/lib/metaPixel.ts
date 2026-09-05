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

/** Fan paid Tokens to unlock a PPV — reported at its USD equivalent. */
export function trackPpvPurchase(tokens: number, messageId: string) {
  if (!(tokens > 0)) return;
  trackPixel("Purchase", {
    value: Number(((tokens * CENTS_PER_TOKEN) / 100).toFixed(2)),
    currency: "USD",
    content_type: "product",
    content_ids: [messageId],
    content_name: "PPV unlock",
    num_items: 1,
  });
}
