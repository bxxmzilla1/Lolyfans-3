import { redirect } from "next/navigation";
import { getOwnerId } from "@/lib/session";
import OwnerShell from "@/components/OwnerShell";
import OwnerDarkMode from "@/components/OwnerDarkMode";

export const dynamic = "force-dynamic";

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await getOwnerId())) redirect("/creator");
  return (
    <>
      <OwnerDarkMode />
      <OwnerShell>{children}</OwnerShell>
    </>
  );
}
