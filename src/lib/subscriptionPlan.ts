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

export const SUB_INTERVAL_LABEL: Record<SubInterval, string> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  lifetime: "lifetime",
};

export function subPlanFromMetadata(meta: Record<string, unknown>): SubPlan {
  const priceCents = Math.max(0, Math.round(Number(meta.sub_price_cents) || 0));
  const rawInterval = meta.sub_interval;
  const interval: SubInterval =
    rawInterval === "day" || rawInterval === "week" || rawInterval === "lifetime"
      ? rawInterval
      : "month";
  // Trials and first-period discounts only make sense on recurring billing.
  const recurring = priceCents > 0 && interval !== "lifetime";
  const trialDays = recurring
    ? Math.min(365, Math.max(0, Math.floor(Number(meta.sub_trial_days) || 0)))
    : 0;
  const discountPct = recurring
    ? Math.min(95, Math.max(0, Math.floor(Number(meta.sub_discount_pct) || 0)))
    : 0;
  return { priceCents, interval, trialDays, discountPct };
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

/** Right-hand side of the SUBSCRIBE button. */
export function subCtaLabel(plan: SubPlan): string {
  if (plan.priceCents <= 0) return "FREE";
  if (plan.trialDays > 0)
    return `${plan.trialDays} ${plan.trialDays === 1 ? "day" : "days"} free trial`;
  if (plan.discountPct > 0)
    return `${subDollars(subFirstPeriodCents(plan))} first ${plan.interval}`;
  return subPriceLabel(plan);
}

/** Small print under the SUBSCRIBE button for trials / discounts. */
export function subCaption(plan: SubPlan): string | null {
  if (plan.priceCents <= 0) return null;
  if (plan.interval === "lifetime") return "One-time payment · lifetime access";
  const full = subPriceLabel(plan);
  if (plan.trialDays > 0 && plan.discountPct > 0) {
    return `Then ${plan.discountPct}% off your first ${plan.interval} (${subDollars(
      subFirstPeriodCents(plan)
    )}), then ${full}`;
  }
  if (plan.trialDays > 0 || plan.discountPct > 0) return `Then ${full}`;
  return null;
}
