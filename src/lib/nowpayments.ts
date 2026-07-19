import crypto from "crypto";

/**
 * Thin NOWPayments client. The platform holds one NOWPayments account, so the
 * API key and IPN secret come from the environment (not per-creator).
 */

const API_BASE = "https://api.nowpayments.io/v1";

export function nowpaymentsConfigured(): boolean {
  return !!process.env.NOWPAYMENTS_API_KEY;
}

export type CreateInvoiceInput = {
  amountCents: number;
  orderId: string;
  orderDescription: string;
  ipnCallbackUrl: string;
  successUrl: string;
  cancelUrl: string;
};

/**
 * Create a hosted-checkout invoice. Returns the URL the fan is sent to in order
 * to pay (any supported coin), plus the NOWPayments invoice id.
 */
export async function createInvoice(
  input: CreateInvoiceInput
): Promise<{ invoiceUrl: string; invoiceId: string } | null> {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(`${API_BASE}/invoice`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      price_amount: input.amountCents / 100,
      price_currency: "usd",
      order_id: input.orderId,
      order_description: input.orderDescription,
      ipn_callback_url: input.ipnCallbackUrl,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      is_fee_paid_by_user: true,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id?: string | number; invoice_url?: string };
  if (!data.invoice_url || data.id == null) return null;
  return { invoiceUrl: data.invoice_url, invoiceId: String(data.id) };
}

/**
 * Verify an IPN callback. NOWPayments signs the JSON body (keys sorted
 * alphabetically) with HMAC-SHA512 using the IPN secret and puts it in the
 * `x-nowpayments-sig` header.
 */
export function verifyIpnSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret || !signature) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const sorted = JSON.stringify(sortKeys(parsed));
  const expected = crypto.createHmac("sha512", secret).update(sorted).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}
