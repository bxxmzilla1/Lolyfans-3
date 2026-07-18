// Twilio Messages API: sends the plain SMS nudges ("you got a message")
// to offline guests who registered with a phone number.
//
// Required environment variables (set in Vercel):
//   TWILIO_ACCOUNT_SID - from the Twilio console dashboard
//   TWILIO_AUTH_TOKEN  - from the Twilio console dashboard
// plus one of:
//   TWILIO_MESSAGING_SERVICE_SID - a Messaging Service SID ("MG...")
//   TWILIO_FROM_NUMBER           - a Twilio phone number in E.164 ("+1...")

/**
 * Send a plain SMS through the Twilio Messages API. Returns true when
 * accepted by Twilio.
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
