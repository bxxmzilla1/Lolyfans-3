import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import {
  ensureStripeCustomer,
  recordBlurDrainTap,
  saveStripePaymentMethod,
} from "@/lib/payments";
import { parseBlurDrainer } from "@/lib/blurDrainer";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { visitorCountryCode } from "@/lib/geo";
import { broadcast } from "@/lib/realtime";
import Stripe from "stripe";

/** GET: current progress for this fan + message. */
export async function GET(req: NextRequest) {
  const messageId = req.nextUrl.searchParams.get("messageId");
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: message } = await db
    .from("messages")
    .select("id, chat_id, blur_drainer")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await guestOwnsChat(req.headers, message.chat_id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfg = parseBlurDrainer(message.blur_drainer);
  if (!cfg) return NextResponse.json({ error: "Not a BlurDrainer message" }, { status: 400 });

  const { data: prog } = await db
    .from("message_blur_progress")
    .select("layers_cleared, pending_layers")
    .eq("message_id", messageId)
    .eq("chat_id", message.chat_id)
    .maybeSingle();

  return NextResponse.json({
    config: cfg,
    layersCleared: prog?.layers_cleared ?? 0,
    // Unbilled taps left over from a previous session — the player settles
    // them right away when it reopens.
    pendingLayers: prog?.pending_layers ?? 0,
  });
}

/**
 * POST: charge one BlurDrainer tap (one layer). One-tap with a saved card;
 * otherwise returns an embedded PaymentIntent client secret.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const { messageId, embedded, paymentIntentId, setupIntentId, settle } =
    await req.json();
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: message } = await db
    .from("messages")
    .select("id, chat_id, blur_drainer")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await guestOwnsChat(req.headers, message.chat_id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfg = parseBlurDrainer(message.blur_drainer);
  if (!cfg) return NextResponse.json({ error: "Not a BlurDrainer message" }, { status: 400 });

  const { data: prog } = await db
    .from("message_blur_progress")
    .select("layers_cleared, pending_layers")
    .eq("message_id", messageId)
    .eq("chat_id", message.chat_id)
    .maybeSingle();
  const cleared = prog?.layers_cleared ?? 0;
  const pending = prog?.pending_layers ?? 0;

  // Settle: bill all unbilled taps as ONE combined charge. Rapid-fire per-tap
  // charges trip bank velocity / duplicate-transaction rules, so taps after
  // the first only advance progress and are settled here in a batch. Must run
  // before the "all layers cleared" early-return — the final taps of a fully
  // cleared drain still need billing.
  if (settle === true && cfg.priceCents > 0) {
    if (pending <= 0) {
      return NextResponse.json({ ok: true, layersCleared: cleared, pendingLayers: 0 });
    }
    const amount = pending * cfg.priceCents;
    const metadata = {
      chatId: message.chat_id,
      kind: "blur-drain-settle",
      messageId: message.id,
      layersCount: String(pending),
    };
    const { data: chat } = await db
      .from("chats")
      .select("stripe_customer_id, stripe_payment_method_id")
      .eq("id", message.chat_id)
      .maybeSingle();
    if (chat?.stripe_customer_id && chat?.stripe_payment_method_id) {
      try {
        const pi = await stripe().paymentIntents.create({
          amount,
          currency: "usd",
          customer: chat.stripe_customer_id,
          payment_method: chat.stripe_payment_method_id,
          off_session: true,
          confirm: true,
          metadata,
          description: `BlurDrainer × ${pending} tap${pending === 1 ? "" : "s"}`,
        });
        // Layers already advanced at tap time — just ledger the batch and
        // zero the pending counter. Conflict = webhook got there first.
        await db.from("message_blur_taps").insert({
          message_id: message.id,
          chat_id: message.chat_id,
          stripe_payment_intent_id: pi.id,
        });
        await db
          .from("message_blur_progress")
          .update({ pending_layers: 0, updated_at: new Date().toISOString() })
          .eq("message_id", message.id)
          .eq("chat_id", message.chat_id);
        return NextResponse.json({ ok: true, layersCleared: cleared, pendingLayers: 0 });
      } catch {
        // Charge declined — fall through to refog the unpaid layers.
      }
    }
    // Settlement failed: fog the unbilled layers back and let the fan retry
    // with the embedded card sheet (marked as a refog retry so completing it
    // re-advances the layers).
    const refogged = Math.max(0, cleared - pending);
    await db
      .from("message_blur_progress")
      .update({
        layers_cleared: refogged,
        pending_layers: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("message_id", message.id)
      .eq("chat_id", message.chat_id);
    await broadcast(`chat:${message.chat_id}`, "blur-drain-progress", {
      messageId: message.id,
      layersCleared: refogged,
    });
    if (embedded === true) {
      const customerId = await ensureStripeCustomer(message.chat_id);
      const pi = await stripe().paymentIntents.create({
        amount,
        currency: "usd",
        customer: customerId,
        payment_method_types: ["card"],
        setup_future_usage: "off_session",
        metadata: { ...metadata, refog: "1" },
        description: `BlurDrainer × ${pending} tap${pending === 1 ? "" : "s"}`,
      });
      return NextResponse.json({
        clientSecret: pi.client_secret,
        amountCents: amount,
        layersCleared: refogged,
        refogged: true,
        country: await visitorCountryCode(req.headers),
      });
    }
    return NextResponse.json(
      { ok: false, layersCleared: refogged, refogged: true },
      { status: 402 }
    );
  }

  if (cleared >= cfg.layers) {
    return NextResponse.json({ ok: true, layersCleared: cleared, done: true });
  }

  // Free BlurDrainer: completing the card-verification SetupIntent unlocks
  // the tapped layer without any charge.
  if (typeof setupIntentId === "string" && setupIntentId) {
    const si = await stripe().setupIntents.retrieve(setupIntentId);
    if (si.status !== "succeeded") {
      return NextResponse.json({ error: "Verification not complete" }, { status: 400 });
    }
    if (si.metadata?.kind !== "blur-drain-verify" || si.metadata.messageId !== messageId) {
      return NextResponse.json({ error: "Invalid verification" }, { status: 400 });
    }
    const customerId =
      typeof si.customer === "string" ? si.customer : si.customer?.id ?? null;
    const pmId =
      typeof si.payment_method === "string"
        ? si.payment_method
        : si.payment_method?.id ?? null;
    await saveStripePaymentMethod(message.chat_id, customerId, pmId);
    const layersCleared = await recordBlurDrainTap({
      messageId,
      chatId: message.chat_id,
      layers: cfg.layers,
      paymentIntentId: `free_${si.id}`,
    });
    return NextResponse.json({
      ok: true,
      layersCleared,
      done: layersCleared >= cfg.layers,
    });
  }

  // Completing an embedded PaymentIntent after the wizard succeeds — a single
  // tap ("blur-drain") or a failed-settlement retry ("blur-drain-settle",
  // which restores every layer the batch covered).
  if (typeof paymentIntentId === "string" && paymentIntentId) {
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== "succeeded") {
      return NextResponse.json({ error: "Payment not complete" }, { status: 400 });
    }
    const kind = pi.metadata?.kind;
    if (
      (kind !== "blur-drain" && kind !== "blur-drain-settle") ||
      pi.metadata?.messageId !== messageId
    ) {
      return NextResponse.json({ error: "Invalid payment" }, { status: 400 });
    }
    const customerId =
      typeof pi.customer === "string" ? pi.customer : pi.customer?.id ?? null;
    const pmId =
      typeof pi.payment_method === "string"
        ? pi.payment_method
        : pi.payment_method?.id ?? null;
    await saveStripePaymentMethod(message.chat_id, customerId, pmId);
    const count =
      kind === "blur-drain-settle"
        ? Math.max(1, Math.round(Number(pi.metadata?.layersCount)) || 1)
        : 1;
    const layersCleared = await recordBlurDrainTap({
      messageId,
      chatId: message.chat_id,
      layers: cfg.layers,
      paymentIntentId: pi.id,
      count,
    });
    return NextResponse.json({
      ok: true,
      layersCleared,
      done: layersCleared >= cfg.layers,
    });
  }

  const { data: chat } = await db
    .from("chats")
    .select("stripe_customer_id, stripe_payment_method_id")
    .eq("id", message.chat_id)
    .maybeSingle();

  const s = stripe();
  const metadata = {
    chatId: message.chat_id,
    kind: "blur-drain",
    messageId: message.id,
  };
  const price = cfg.priceCents;

  // Free BlurDrainer: no charge per tap, but the fan needs a verified card.
  if (price <= 0) {
    if (chat?.stripe_customer_id && chat?.stripe_payment_method_id) {
      const layersCleared = await recordBlurDrainTap({
        messageId: message.id,
        chatId: message.chat_id,
        layers: cfg.layers,
        paymentIntentId: `free_${message.id}_${cleared + 1}`,
      });
      return NextResponse.json({
        ok: true,
        layersCleared,
        done: layersCleared >= cfg.layers,
      });
    }
    if (embedded === true) {
      const customerId = await ensureStripeCustomer(message.chat_id);
      const si = await s.setupIntents.create({
        customer: customerId,
        payment_method_types: ["card"],
        usage: "off_session",
        metadata: { ...metadata, kind: "blur-drain-verify" },
      });
      return NextResponse.json({
        setupClientSecret: si.client_secret,
        country: await visitorCountryCode(req.headers),
        needsCard: true,
      });
    }
    return NextResponse.json(
      { error: "Verify your card to continue unblurring" },
      { status: 402 }
    );
  }

  if (chat?.stripe_customer_id && chat?.stripe_payment_method_id) {
    // After the first paid layer, taps advance instantly WITHOUT a charge —
    // they accumulate in pending_layers and settle later as one combined
    // PaymentIntent (see the settle branch above). One charge per tap looks
    // like fraud to banks and gets declined.
    if (cleared > 0) {
      const next = Math.min(cfg.layers, cleared + 1);
      await db.from("message_blur_progress").upsert(
        {
          message_id: message.id,
          chat_id: message.chat_id,
          layers_cleared: next,
          pending_layers: pending + 1,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "message_id,chat_id" }
      );
      await broadcast(`chat:${message.chat_id}`, "blur-drain-progress", {
        messageId: message.id,
        layersCleared: next,
      });
      return NextResponse.json({
        ok: true,
        layersCleared: next,
        pendingLayers: pending + 1,
        done: next >= cfg.layers,
      });
    }
    try {
      const pi = await s.paymentIntents.create({
        amount: price,
        currency: "usd",
        customer: chat.stripe_customer_id,
        payment_method: chat.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata,
        description: "BlurDrainer tap",
      });
      const layersCleared = await recordBlurDrainTap({
        messageId: message.id,
        chatId: message.chat_id,
        layers: cfg.layers,
        paymentIntentId: pi.id,
      });
      return NextResponse.json({
        ok: true,
        layersCleared,
        done: layersCleared >= cfg.layers,
      });
    } catch (err) {
      void err;
      // Card declined / needs auth — fall through to embedded card entry.
    }
  }

  const hadCard = !!(chat?.stripe_customer_id && chat?.stripe_payment_method_id);
  const customerId = await ensureStripeCustomer(message.chat_id);
  if (embedded === true) {
    const pi = await s.paymentIntents.create({
      amount: price,
      currency: "usd",
      customer: customerId,
      payment_method_types: ["card"],
      setup_future_usage: "off_session",
      metadata,
      description: "BlurDrainer tap",
    });
    return NextResponse.json({
      clientSecret: pi.client_secret,
      amountCents: price,
      country: await visitorCountryCode(req.headers),
      // True when the fan has never saved a card — player shows a softer prompt.
      needsCard: !hadCard,
    });
  }

  return NextResponse.json(
    { error: "Add a card to continue unblurring" },
    { status: 402 }
  );
}
