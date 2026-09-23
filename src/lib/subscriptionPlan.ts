export type SubInterval = "day" | "week" | "month" | "lifetime";

/** A creator's profile-subscription plan, read from their auth metadata. */
export type SubPlan = {
  /** 0 = free subscription (plain follow). */
  priceCents: number;
  /** "lifetime" = a single one-time payment, access forever. */
  interval: SubInterval;
  /** Free-trial days before the first charge (0 = none). */
  trialDays: number;
  /** Percentage off the first billing period (0 = none). */
  discountPct: number;
};

/** Card-step summary title: one subscription covers the whole site. */
export const SUB_UNLIMITED_TITLE = "Lolyfans Subscription";

export const SUB_INTERVAL_LABEL: Record<SubInterval, string> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  lifetime: "lifetime",
};

/** Every profile is free to subscribe to (no card step at signup). */
export const FREE_PLAN: SubPlan = {
  priceCents: 0,
  interval: "month",
  trialDays: 0,
  discountPct: 0,
};

/**
 * Paid subscriptions / free trials were removed from creator settings. Any
 * sub_price_cents / sub_trial_days left in older accounts' metadata is
 * ignored so nobody stays behind a paywall they can no longer switch off.
 * Fans still add a card on their first purchase (one-tap top-ups / unlocks).
 */
export function subPlanFromMetadata(_meta: Record<string, unknown>): SubPlan {
  void _meta;
  return FREE_PLAN;
}

export function subDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/** "$9.99 / month" — or "$99 lifetime" for one-time plans. */
export function subPriceLabel(plan: SubPlan): string {
  return plan.interval === "lifetime"
    ? `${subDollars(plan.priceCents)} lifetime`
    : `${subDollars(plan.priceCents)} / ${plan.interval}`;
}

/** First billing period price after the discount. */
export function subFirstPeriodCents(plan: SubPlan): number {
  return Math.round((plan.priceCents * (100 - plan.discountPct)) / 100);
}

/**
 * Right-hand side of the SUBSCRIBE button. Always the recurring price — the
 * trial is applied at checkout but never advertised on the button.
 */
export function subCtaLabel(plan: SubPlan): string {
  if (plan.priceCents <= 0) return "FREE";
  if (plan.discountPct > 0)
    return `${subDollars(subFirstPeriodCents(plan))} first ${plan.interval}`;
  return subPriceLabel(plan);
}

/**
 * Both halves of the profile bar. Trial plans lead with the trial instead of
 * the price ("FREE TRIAL · 30 DAYS"); the caption below still shows the
 * price that follows.
 */
export function subButtonLabels(plan: SubPlan): { left: string; right: string } {
  if (plan.priceCents > 0 && plan.trialDays > 0) {
    return {
      left: "FREE TRIAL",
      right: `${plan.trialDays} ${plan.trialDays === 1 ? "DAY" : "DAYS"}`,
    };
  }
  return { left: "SUBSCRIBE", right: subCtaLabel(plan) };
}

/**
 * Small print under the SUBSCRIBE button: the trial (if any), the normal
 * recurring price, and "Cancel anytime". The button itself stays price-free.
 */
export function subCaption(plan: SubPlan): string | null {
  if (plan.priceCents <= 0) return null;
  if (plan.interval === "lifetime") return "One-time payment · lifetime access";
  const full = subPriceLabel(plan);
  const base =
    plan.trialDays > 0
      ? `${plan.trialDays} ${plan.trialDays === 1 ? "day" : "days"} free trial · then ${full}`
      : full;
  return `${base} · Cancel anytime`;
}
