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
    default:
      return m.settings_qbo_oauth_error_unknown({ code });
  }
}

/**
 * Not a transient flash: a failure the tenant has to act on must still be on
 * screen when they look back at it.
 */
export function QboOAuthOutcomeBanner({ outcome }: { outcome: QboOAuthOutcome }) {
  if (outcome.connected) {
    return (
      <div
        role="status"
        className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium"
      >
        {m.settings_qbo_oauth_connected()}
      </div>
    );
  }
  if (outcome.error) {
    return (
      <div
        role="alert"
        className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium"
      >
        {qboOAuthErrorMessage(outcome.error)}
      </div>
    );
  }
  return null;
}
