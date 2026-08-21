import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Old fan home — the public Home Feed lives on the root page now. */
export default async function FanHomePage() {
  redirect("/");
}
