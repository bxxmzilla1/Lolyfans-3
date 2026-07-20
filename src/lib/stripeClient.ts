"use client";

import { loadStripe, type Appearance, type Stripe } from "@stripe/stripe-js";

let promise: Promise<Stripe | null> | null = null;

export function stripePublishableKey(): string {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
}

/** True when the in-page Payment Element flow can run. */
export function elementsEnabled(): boolean {
  return !!stripePublishableKey();
}

export function getStripe(): Promise<Stripe | null> {
  if (!promise) promise = loadStripe(stripePublishableKey());
  return promise;
}

/**
 * Style the Payment Element with the site's CSS variables so the card
 * fields look native to the current (light/dark) theme.
 */
export function stripeAppearance(): Appearance {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  return {
    theme: "flat",
    variables: {
      colorPrimary: v("--accent", "#00aff0"),
      colorBackground: v("--card-2", "#16212c"),
      colorText: v("--fg", "#f2f6f9"),
      colorTextSecondary: v("--muted", "#8b98a5"),
      colorTextPlaceholder: v("--muted", "#8b98a5"),
      colorDanger: "#f87171",
      borderRadius: "12px",
      fontSizeBase: "15px",
      spacingUnit: "4px",
    },
    rules: {
      ".Input": {
        border: `1px solid ${v("--line", "#202d3b")}`,
        boxShadow: "none",
      },
      ".Input:focus": {
        border: `1px solid ${v("--accent", "#00aff0")}`,
        boxShadow: "none",
      },
      ".Label": {
        color: v("--muted", "#8b98a5"),
        fontSize: "12px",
        fontWeight: "600",
      },
      ".Tab, .Block": {
        border: `1px solid ${v("--line", "#202d3b")}`,
        boxShadow: "none",
      },
    },
  };
}
