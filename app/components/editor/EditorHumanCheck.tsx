import type { ReactNode } from "react";
import { OutboundVerificationProvider } from "~/components/OutboundVerification";

/**
 * Mounts the human check for the full-screen editor, which sits outside the
 * workspace layout and so has none of its own. `coolingWindow` is what the editor's
 * loader read from the session context: non-null only while a new company's first
 * 24 hours are open.
 */
export function EditorHumanCheck({
  coolingWindow,
  children,
}: {
  coolingWindow: { unlockAtMs: number; turnstileSiteKey: string | null } | null;
  children: ReactNode;
}) {
  return (
    <OutboundVerificationProvider
      windowOpen={coolingWindow != null}
      siteKey={coolingWindow?.turnstileSiteKey ?? null}
    >
      {children}
    </OutboundVerificationProvider>
  );
}
