import { redirect } from "next/navigation";
import { getOwnerId } from "@/lib/session";
import OwnerShell from "@/components/OwnerShell";
import OwnerDarkMode from "@/components/OwnerDarkMode";

export const dynamic = "force-dynamic";

/**
 * Runs while the HTML is still streaming in — before first paint — so a
 * refreshed owner page never flashes the light palette. OwnerDarkMode still
 * handles client-side navigations (and restores light mode on leave).
 */
const DARK_BEFORE_PAINT = `document.documentElement.classList.remove("light");document.documentElement.classList.add("owner-dark");`;

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await getOwnerId())) redirect("/creator");
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: DARK_BEFORE_PAINT }} />
      <OwnerDarkMode />
      <OwnerShell>{children}</OwnerShell>
    </>
  );
}
