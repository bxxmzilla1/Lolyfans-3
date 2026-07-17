"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AdminCodeDialog from "./AdminCodeDialog";

/**
 * Invisible button in the top-right corner (web view only). Clicking it asks
 * for the admin code, then leaves the guest chat for the sign in / sign up page.
 */
export default function OwnerEscapeHatch() {
  const [asking, setAsking] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        onClick={() => setAsking(true)}
        aria-label="Owner access"
        tabIndex={-1}
        className="hidden lg:block fixed top-0 right-0 z-40 w-12 h-12 opacity-0 cursor-default"
      />
      {asking && (
        <AdminCodeDialog
          title="Owner access"
          message="Enter the admin code to go to the sign in page."
          onVerified={() => {
            setAsking(false);
            router.push("/");
            router.refresh();
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  );
}
