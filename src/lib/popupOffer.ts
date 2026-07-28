/**
 * Card Verify: while a fan has no card on file, every photo/video from the
 * creator renders blurred with a "Verify to view" button that opens the
 * embedded Stripe card inputs (SetupIntent — no charge). Prevents fraud and
 * keeps minors away from adult content.
 */
export type VerifyPopup = {
  enabled: boolean;
};

export const DEFAULT_VERIFY_POPUP: VerifyPopup = {
  enabled: true,
};

/** Read a creator's Card Verify config from their auth user_metadata. */
export function verifyPopupFromMetadata(meta: Record<string, unknown>): VerifyPopup {
  return {
    // Anything but an explicit false keeps it on (the default).
    enabled: meta.verify_popup_enabled !== false,
  };
}
