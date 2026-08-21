import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Voice calls removed with in-app chat — fans go to the Home Feed. */
export default async function CallPage() {
  redirect("/");
}
