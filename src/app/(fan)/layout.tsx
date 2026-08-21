import { redirect } from "next/navigation";

/**
 * Old fan shell routes (/home, /profile) — the public Home Feed lives on the
 * root page now, so everything here just goes there.
 */
export default async function FanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  void children;
  redirect("/");
}
