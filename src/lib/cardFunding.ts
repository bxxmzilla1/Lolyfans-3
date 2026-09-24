import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";

/**
 * Credit cards only. Stripe reports a card's funding type on the
 * PaymentMethod ("credit" | "debit" | "prepaid" | "unknown"); anything that
 * isn't "credit" is refused. The card wizard checks this client-side before
 * confirming, and these helpers enforce it server-side too.
 */
export const CREDIT_ONLY_MESSAGE =
  "Only credit cards are accepted. Please use a credit card.";

export function isCreditCard(pm: Stripe.PaymentMethod | null | undefined): boolean {
  return pm?.type === "card" && pm.card?.funding === "credit";
}

/** Look up a PaymentMethod's funding type. Null = couldn't load it. */
export async function paymentMethodFunding(
  paymentMethodId: string | null | undefined
): Promise<Stripe.PaymentMethod | null> {
  if (!paymentMethodId) return null;
  try {
    return await stripe().paymentMethods.retrieve(paymentMethodId);
  } catch {
    return null;
  }
}

/**
 * A succeeded PaymentIntent paid with a non-credit card (someone bypassed
 * the client check): refund it in full and detach the card so it's never
 * saved for one-tap. Returns true when the payment was refused.
 * Idempotent per intent — safe from both the API route and the webhook.
 */
export async function refuseNonCreditPayment(pi: Stripe.PaymentIntent): Promise<boolean> {
  const pmId =
    typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
  const pm =
    typeof pi.payment_method === "object" && pi.payment_method
      ? pi.payment_method
      : await paymentMethodFunding(pmId);
  if (!pm || isCreditCard(pm)) return false;

  const s = stripe();
  try {
    await s.refunds.create(
      { payment_intent: pi.id, reason: "requested_by_customer" },
      { idempotencyKey: `refund-noncredit-${pi.id}` }
    );
  } catch {
    // Already refunded (webhook + route racing) — still refuse.
  }
  if (pm.customer) await s.paymentMethods.detach(pm.id).catch(() => {});
  return true;
}

/**
 * A succeeded SetupIntent that saved a non-credit card: detach it so it's
 * never used. Returns true when refused.
 */
export async function refuseNonCreditSetup(si: Stripe.SetupIntent): Promise<boolean> {
  const pmId =
    typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
  const pm =
    typeof si.payment_method === "object" && si.payment_method
      ? si.payment_method
      : await paymentMethodFunding(pmId);
  if (!pm || isCreditCard(pm)) return false;
  if (pm.customer) await stripe().paymentMethods.detach(pm.id).catch(() => {});
  return true;
}
