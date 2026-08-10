import { redirect } from "next/navigation";
import { getOwnerId } from "@/lib/session";
import AuthForm from "@/components/AuthForm";
import Logo from "@/components/Logo";
import OwnerDarkMode from "@/components/OwnerDarkMode";

export const dynamic = "force-dynamic";

/** Creator sign in / sign up. Unaffected by the public Telegram redirect. */
export default async function CreatorAuthPage() {
  if (await getOwnerId()) redirect("/inbox");

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 min-h-dvh">
      <OwnerDarkMode />
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-4">
          <Logo className="w-20 h-20 glow-accent" />
          <h1 className="text-4xl font-bold ig-gradient-text tracking-tight">
            LolyFans
          </h1>
          <p className="text-muted text-sm text-center">
            Creator sign in — manage Telegram, vault, and invite links.
          </p>
        </div>
        <AuthForm />
      </div>
    </main>
  );
}
