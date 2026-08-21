import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Old fan profile — everything goes to the public Home Feed. */
export default async function FanProfilePage() {
  redirect("/");
}
