import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Invite links moved into Settings → Invite links. */
export default function InvitesPage() {
  redirect("/inbox");
}
