import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** In-app guest chats removed — creators use the Telegram inbox only. */
export default async function OwnerChatPage() {
  redirect("/inbox");
}
