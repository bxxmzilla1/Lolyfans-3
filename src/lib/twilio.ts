// Twilio Verify: sends the SMS verification code and checks the code the
// guest types back. Uses the REST API directly (no SDK needed).
//
// Required environment variables (set in Vercel):
//   TWILIO_ACCOUNT_SID        - from the Twilio console dashboard
//   TWILIO_AUTH_TOKEN         - from the Twilio console dashboard
//   TWILIO_VERIFY_SERVICE_SID - a Verify Service SID (starts with "VA...",
//                               create one under Verify > Services)
//
// For plain SMS notifications (offline "you got a message" nudges), also set
// one of:
//   TWILIO_MESSAGING_SERVICE_SID - a Messaging Service SID ("MG...")
//   TWILIO_FROM_NUMBER           - a Twilio phone number in E.164 ("+1...")

const VERIFY_BASE = "https://verify.twilio.com/v2";

function twilioEnv() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid || !token || !service) return null;
  return { sid, token, service };
}

type TwilioResponse = {
  status: number;
  data: { status?: string; code?: number; message?: string } | null;
};

async function twilioPost(
  path: string,
  form: Record<string, string>
): Promise<TwilioResponse | { error: string }> {
  const env = twilioEnv();
  if (!env) {
    return { error: "SMS verification is not configured yet. Try again later." };
  }
  const res = await fetch(`${VERIFY_BASE}/Services/${env.service}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.sid}:${env.token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

export function isE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

/** Send the SMS code. Returns null on success, or a user-facing error. */
export async function startSmsVerification(phone: string): Promise<string | null> {
  const out = await twilioPost("/Verifications", { To: phone, Channel: "sms" });
  if ("error" in out) return out.error;
  if (out.status >= 200 && out.status < 300) return null;

  const code = out.data?.code;
  if (code === 60200 || code === 21211 || code === 21614) {
    return "That phone number doesn't look valid. Check it and try again.";
  }
  if (code === 60203) {
    return "Too many codes sent to this number. Wait a few minutes and try again.";
  }
  if (code === 60205 || code === 21408 || code === 21612) {
    return "SMS can't be delivered to this number. Try a different one.";
  }
  return "Couldn't send the verification code. Try again in a moment.";
}

/**
 * Check the code the guest typed. Returns null when approved, or a
 * user-facing error when the code is wrong/expired.
 */
export async function checkSmsVerification(
  phone: string,
  code: string
): Promise<string | null> {
  const out = await twilioPost("/VerificationCheck", { To: phone, Code: code });
  if ("error" in out) return out.error;
  // Twilio returns 404 when the verification expired or was already used.
  if (out.status === 404) {
    return "This code has expired. Request a new one and try again.";
  }
  if (out.status >= 200 && out.status < 300 && out.data?.status === "approved") {
    return null;
  }
  return "Wrong verification code. Check the SMS and try again.";
}

/**
 * Send a plain SMS (not a verification code) through the Twilio Messages API.
 * Returns true when accepted by Twilio. Needs a Messaging Service SID or a
 * From number on top of the account credentials.
 */
export async function sendSms(to: string, body: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const messagingService = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || (!messagingService && !from)) return false;

  const form = new URLSearchParams({ To: to, Body: body });
  if (messagingService) form.set("MessagingServiceSid", messagingService);
  else form.set("From", from!);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Twilio SMS send failed:", res.status, text.slice(0, 300));
  }
  return res.ok;
}
