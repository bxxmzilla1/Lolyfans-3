import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOwnerId, getGuestChatId } from "@/lib/session";
import { ipFromHeaders } from "@/lib/invites";
import { supabaseAdmin } from "@/lib/supabase/admin";
import AuthForm from "@/components/AuthForm";
import Logo from "@/components/Logo";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string }>;
}) {
  if (await getOwnerId()) redirect("/inbox");

  // Only resume the guest chat if the cookie points at a chat that still exists.
  // (A cookie left over from a deleted chat would otherwise ping-pong with /chat.)
  const guestChatId = await getGuestChatId();
  if (guestChatId) {
    const { data: existing } = await supabaseAdmin()
      .from("chats")
      .select("id")
      .eq("id", guestChatId)
      .maybeSingle();
    if (existing) redirect("/chat");
  }

  // Returning guest without a usable cookie (none at all, or one pointing at a
  // deleted chat)? The device is remembered by IP — match it to a previous
  // chat so typing the bare domain always reopens the same conversation.
  const { resume } = await searchParams;
  if (resume !== "0") {
    const ip = ipFromHeaders(await headers());
    if (ip) {
      const { data: chat } = await supabaseAdmin()
        .from("chats")
        .select("id")
        .eq("guest_ip", ip)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (chat) redirect("/api/resume");
    }
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-4">
          <Logo className="w-20 h-20 glow-accent" />
          <h1 className="text-4xl font-bold ig-gradient-text tracking-tight">
            Lolyfans
          </h1>
          <p className="text-muted text-sm text-center">
            Sign in or create an account to manage your chats, vault and invite
            links.
          </p>
        </div>
        <AuthForm />
        <p className="text-sm text-muted -mt-2">
          Joined through an invite link?{" "}
          <Link href="/login" className="text-accent font-semibold">
            Log in here
          </Link>
        </p>
      </div>
    </main>
  );
}
