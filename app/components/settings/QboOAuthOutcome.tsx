import { useState } from "react";
import { Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * How the QuickBooks OAuth round trip ended.
 *
 * `server/api/qbo-oauth.ts` reports every outcome — success and each distinct
 * failure — by redirecting the browser back to the settings page with a query
 * parameter. Nothing used to read any of them, so a user who clicked Connect
 * with no credentials, whose `state` had expired, or who declined at Intuit
 * landed back on an unchanged page and was told nothing at all. Successes were
 * just as silent.
 */
export interface QboOAuthOutcome {
  connected: boolean;
  /** The raw `error` code, already length-bounded by the loader. */
  error: string | null;
}

/**
 * Error codes the OAuth routes can redirect with, mapped to copy a tenant can
 * act on. An unrecognized code still renders — as itself — because a silent
 * unknown is the failure this component exists to prevent.
 */
function qboOAuthErrorMessage(code: string): string {
  switch (code) {
    case "not_configured":
      return m.settings_qbo_oauth_error_not_configured();
    case "missing_qbo_env":
      return m.settings_qbo_oauth_error_missing_qbo_env();
    case "missing_base_url":
      return m.settings_qbo_oauth_error_missing_base_url();
    case "invalid_state":
      return m.settings_qbo_oauth_error_invalid_state();
    case "oauth_failed":
      return m.settings_qbo_oauth_error_failed();
    case "access_denied":
      return m.settings_qbo_oauth_error_access_denied();
    case "realm_already_connected":
      // Not a failure of the OAuth round trip — Intuit said yes. One
      // QuickBooks company may only be bound to one OpenInspection company, because the
      // webhook resolves its tenant by realm id and nothing else.
      return m.settings_qbo_oauth_error_realm_already_connected();
    default:
      return m.settings_qbo_oauth_error_unknown({ code });
  }
}

/**
 * Not a transient flash: a failure the person has to act on must still be on
 * screen when they look back at it, so only the success banner can be closed.
 * A failure has no Dismiss on purpose -- fixing the cause and connecting again
 * is what clears it.
 */
export function QboOAuthOutcomeBanner({ outcome }: { outcome: QboOAuthOutcome }) {
  const [dismissed, setDismissed] = useState(false);
  if (outcome.connected) {
    if (dismissed) return null;
    return (
      <Banner
        tone="success"
        actions={
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="px-2 py-1 text-[12px] font-bold underline"
          >
            {m.settings_qbo_error_dismiss()}
          </button>
        }
      >
        {m.settings_qbo_oauth_connected()}
      </Banner>
    );
  }
  if (outcome.error) {
    return <Banner tone="danger">{qboOAuthErrorMessage(outcome.error)}</Banner>;
  }
  return null;
}
