import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import GuestLoginForm from "@/components/GuestLoginForm";
import Logo from "@/components/Logo";

export const dynamic = "force-dynamic";

/** Fan login page: sign in with the email + password used at sign-up. */
export default async function GuestLoginPage() {
  // Already logged in as a guest? Straight to their chats.
  const guestChatId = await getGuestChatId();
  if (guestChatId) {
    const { data: existing } = await supabaseAdmin()
      .from("chats")
      .select("id")
      .eq("id", guestChatId)
      .maybeSingle();
    if (existing) redirect("/chats");
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 min-h-dvh">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-4">
          <Logo className="w-20 h-20 glow-accent" />
          <h1 className="text-4xl font-bold ig-gradient-text tracking-tight">
            Lolyfans
          </h1>
          <p className="text-muted text-sm text-center">
            Log in with the email and password you signed up with to get back
            to your chats.
          </p>
        </div>
        <GuestLoginForm />
      </div>
    </main>
  );
}
