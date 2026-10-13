import { useEffect, useRef } from "react";
import { m } from "~/paraglide/messages";
import { pendingProps, PENDING_CLASS } from "@core/shared-ui";

export interface NativeConsentProps {
  /** The registered client's display name, shown as the app being signed in. */
  appName: string;
  /** Private-use scheme the app will be opened through; empty for a loopback redirect. */
  redirectScheme: string;
  /** True when the app is reached on this computer (loopback) rather than by a scheme. */
  redirectLoopback: boolean;
  oauthReqJson: string;
  submitting?: boolean;
}

/**
 * Consent screen for the first-party native client (scope `native`). The grant
 * carries the signed-in user's own access, so there is no module grid to
 * choose from, only a decision. Same native-form shape as `ConsentForm`: it
 * posts the same `oauthReq` field and Cancel posts `cancel`.
 */
export function NativeConsent({ appName, redirectScheme, redirectLoopback, oauthReqJson, submitting = false }: NativeConsentProps) {
  const decided = useRef(false);
  // A restore from the back/forward cache brings this page back with `decided` set while the POST
  // was answered elsewhere; start over so the buttons are not dead.
  useEffect(() => {
    const reopen = (e: PageTransitionEvent) => { if (e.persisted) decided.current = false; };
    window.addEventListener("pageshow", reopen);
    return () => window.removeEventListener("pageshow", reopen);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-ih-bg-app px-4">
      <div className="w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-6">
          <img src="/logo.svg" alt="" className="w-8 h-8" width={32} height={32} />
          <span className="text-lg font-bold text-ih-fg-1">OpenInspection</span>
        </div>

        <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">
          {m.oauth_native_heading({ appName })}
        </h1>
        {/* The app name comes from open dynamic registration, so it proves nothing; say so, and show where the app will be opened. */}
        <p className="text-xs font-bold uppercase tracking-wide text-ih-fg-3 mb-3">{m.oauth_native_unverified()}</p>
        <p className="text-sm text-ih-fg-3 mb-3">{m.oauth_native_description()}</p>
        <p className="text-sm text-ih-fg-2 mb-8 break-all">
          {redirectLoopback ? m.oauth_native_opens_via_computer() : m.oauth_native_opens_via({ scheme: redirectScheme })}
        </p>

        {/* busy-controls-allow: the onSubmit below latches the decision in the decided ref and preventDefaults every later submit in the same frame */}
        <form
          method="post"
          onSubmit={(e) => {
            if (decided.current) e.preventDefault();
            else decided.current = true;
          }}
        >
          <input type="hidden" name="oauthReq" value={oauthReqJson} />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              name="cancel"
              value="1"
              {...pendingProps(submitting)}
              className={`flex-1 py-2.5 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 font-bold text-sm hover:bg-ih-bg-app transition-colors ${PENDING_CLASS}`}
            >
              {m.common_cancel()}
            </button>
            <button
              type="submit"
              data-testid="oauth-native-allow"
              {...pendingProps(submitting)}
              className={`flex-1 py-2.5 rounded-lg bg-ih-primary text-ih-fg-inverse font-bold text-sm hover:bg-ih-primary-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${PENDING_CLASS}`}
            >
              {m.oauth_native_allow()}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
