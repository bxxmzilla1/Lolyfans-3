import Link from "next/link";
import { redirect } from "next/navigation";
import { getOwnerId } from "@/lib/session";
import AuthForm from "@/components/AuthForm";
import Logo from "@/components/Logo";

export const dynamic = "force-dynamic";

/** Creator sign in / sign up. The bare domain is the public feed instead. */
export default async function CreatorAuthPage() {
  if (await getOwnerId()) redirect("/inbox");

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 min-h-dvh">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-4">
          <Logo className="w-20 h-20 glow-accent" />
          <h1 className="text-4xl font-bold ig-gradient-text tracking-tight">
            Lolyfans
          </h1>
          <p className="text-muted text-sm text-center">
            Creator sign in — manage your chats, vault and invite links.
          </p>
        </div>
        <AuthForm />
        <p className="text-sm text-muted -mt-2 text-center">
          Joined through an invite link?{" "}
          <Link href="/login" className="text-accent font-semibold">
            Log in here
          </Link>
        </p>
        <Link href="/" className="text-xs text-muted hover:text-fg transition-colors">
          Back to Lolyfans
        </Link>
      </div>
    </main>
  );
}
