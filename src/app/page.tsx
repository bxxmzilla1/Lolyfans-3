import { redirect } from "next/navigation";
import { getOwnerId, getGuestChatId } from "@/lib/session";
import AuthForm from "@/components/AuthForm";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (await getOwnerId()) redirect("/inbox");
  if (await getGuestChatId()) redirect("/chat");

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-4">
          <div className="ig-ring">
            <div className="w-20 h-20 rounded-full bg-bg flex items-center justify-center text-4xl">
              💬
            </div>
          </div>
          <h1 className="text-4xl font-bold ig-gradient-text tracking-tight">
            Lolyfans
          </h1>
          <p className="text-muted text-sm text-center">
            Sign in or create an account to manage your chats, vault and invite
            links.
          </p>
        </div>
        <AuthForm />
      </div>
    </main>
  );
}
