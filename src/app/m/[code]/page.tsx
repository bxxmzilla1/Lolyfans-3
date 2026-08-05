import { notFound, redirect } from "next/navigation";
import { ownerIdForCpmCode } from "@/lib/cpm";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import CpmLanding from "@/components/CpmLanding";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "TelegramPay",
    icons: { icon: "/telegrampay-logo.webp" },
  };
}

/**
 * Public Chat-per-minute entry: TelegramPay branded paywall, then /chat.
 * Returning fans who already paid for this creator skip straight to chat.
 */
export default async function CpmPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: raw } = await params;
  const code = raw.trim();
  const ownerId = await ownerIdForCpmCode(code);
  if (!ownerId) notFound();

  // Returning fan with an active CPM chat + saved card → skip the paywall.
  const guestChatId = await getGuestChatId();
  if (guestChatId) {
    const { data: chat } = await supabaseAdmin()
      .from("chats")
      .select("id, owner_id, cpm, pending, stripe_payment_method_id")
      .eq("id", guestChatId)
      .maybeSingle();
    if (
      chat &&
      chat.owner_id === ownerId &&
      chat.cpm &&
      !chat.pending &&
      chat.stripe_payment_method_id
    ) {
      redirect("/chat");
    }
  }

  const { data: ownerUser } = await supabaseAdmin().auth.admin.getUserById(
    ownerId
  );
  const meta = (ownerUser?.user?.user_metadata ?? {}) as {
    display_name?: string;
    invite_verified?: boolean;
  };

  return (
    <CpmLanding
      code={code}
      ownerName={meta.display_name || "Creator"}
      verified={!!meta.invite_verified}
    />
  );
}
