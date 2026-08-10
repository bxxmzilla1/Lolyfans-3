import { redirect } from "next/navigation";
import Link from "next/link";
import { getOwnerId } from "@/lib/session";
import { getMainTelegramLink } from "@/lib/mainChannel";

export const dynamic = "force-dynamic";

/**
 * Public homepage: creators go to the inbox; everyone else is sent straight
 * to the main Telegram channel (no feed, no chat). /creator stays separate
 * so creators can always sign in.
 */
export default async function Home() {
  if (await getOwnerId()) redirect("/inbox");

  const link = await getMainTelegramLink();
  if (link) redirect(link);

  // Link not configured yet — tiny page so the site isn't a blank error.
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-muted text-sm">This site redirects to Telegram.</p>
      <p className="text-xs text-muted">
        Are you a creator?{" "}
        <Link href="/creator" className="text-accent font-semibold">
          Sign in here
        </Link>
      </p>
    </main>
  );
}
