import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** In-app chat removed — fans go to the Home Feed. */
export default async function GuestChatPage() {
  redirect("/");
}
