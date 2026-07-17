import { redirect } from "next/navigation";
import { getOwnerId } from "@/lib/session";
import OwnerShell from "@/components/OwnerShell";

export const dynamic = "force-dynamic";

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await getOwnerId())) redirect("/");
  return <OwnerShell>{children}</OwnerShell>;
}
