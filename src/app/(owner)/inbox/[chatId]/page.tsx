import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** In-app guest chats removed — the inbox is the dashboard now. */
export default async function OwnerChatPage() {
  redirect("/inbox");
}
