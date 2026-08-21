import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Fan login removed — users go to the Home Feed. */
export default async function LoginPage() {
  redirect("/");
}
