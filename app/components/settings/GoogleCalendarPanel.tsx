import { useState } from "react";
import { Form } from "react-router";
import { SecretField } from "~/components/SecretField";
import { GoogleSignInButton } from "~/components/GoogleSignInButton";

type CalendarCapability = "availability_read" | "events_read_write";
type GoogleOAuthMode = "platform" | "own";

const CAPABILITY_LABELS: Record<CalendarCapability, string> = {
  availability_read: "Read availability only",
  events_read_write: "Full sync (read + write events)",
};

/**
 * Settings → Communication: Calendar sync (Google + Apple ICS).
 * SaaS tenants default to the platform Google OAuth app; self-host must BYO.
 */
export function GoogleCalendarPanel({
  isSaas,
  googleOAuthConfigured,
  googleOAuthMode,
  secrets,
  secretFieldError,
  secretFormError,
  savingCalendarSecrets,
  savingOAuthMode,
  googleCalendarConnected,
  googleCalendarCapability,
  disconnectingCalendar,
  icsUrl,
}: {
  isSaas: boolean;
  googleOAuthConfigured: boolean;
  googleOAuthMode: GoogleOAuthMode;
  secrets: { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string };
  secretFieldError: (name: string) => string | undefined;
  secretFormError: (intent: string) => string | null;
  savingCalendarSecrets: boolean;
  savingOAuthMode: boolean;
  googleCalendarConnected: boolean;
  googleCalendarCapability: CalendarCapability | null;
  disconnectingCalendar: boolean;
  icsUrl: string | null;
}) {
  const [oauthMode, setOauthMode] = useState<GoogleOAuthMode>(isSaas ? googleOAuthMode : "own");
  const [capability, setCapability] = useState<CalendarCapability>("events_read_write");

  const ownCredsConfigured = Boolean(secrets.GOOGLE_CLIENT_ID?.trim());
  const canConnect = isSaas
    ? oauthMode === "platform"
      ? googleOAuthConfigured
      : ownCredsConfigured
    : googleOAuthConfigured || ownCredsConfigured;

  const connectHref = `/api/calendar/connect?capability=${capability}&provider=google`;

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Calendar sync</h3>

      {/* SaaS: platform vs BYO OAuth app — self-host always BYO */}
      {isSaas ? (
        <div className="space-y-2">
          <div className="inline-flex rounded-md border border-ih-border overflow-hidden">
            {(["platform", "own"] as const).map((m) => (
              <label
                key={m}
                className={`px-3 h-8 flex items-center text-[12px] font-bold cursor-pointer ${
                  oauthMode === m ? "bg-ih-primary text-white" : "bg-ih-bg-card text-ih-fg-2"
                }`}
              >
                <input
                  type="radio"
                  name="_googleOAuthModeRadio"
                  value={m}
                  checked={oauthMode === m}
                  onChange={() => setOauthMode(m)}
                  className="sr-only"
                />
                {m === "platform" ? "Platform Google OAuth" : "My own OAuth app"}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-ih-fg-4">
            {oauthMode === "platform"
              ? "Uses the hosted platform Google OAuth app — no Client ID setup needed. Each inspector connects their own Google account."
              : "Use your own Google Cloud OAuth client. Add credentials below, then connect."}
          </p>
          <Form method="post" className="flex justify-end">
            <input type="hidden" name="intent" value="save-google-oauth-mode" />
            <input type="hidden" name="googleOAuthMode" value={oauthMode} />
            <button
              type="submit"
              disabled={savingOAuthMode || oauthMode === googleOAuthMode}
              className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-50"
            >
              {savingOAuthMode ? "Saving…" : "Save OAuth mode"}
            </button>
          </Form>
        </div>
      ) : (
        <p className="text-[13px] text-ih-fg-3 bg-ih-bg-muted border border-ih-border rounded-md p-3">
          Self-hosted deployments use your own Google Cloud OAuth app. Add Client ID and Secret below,
          then each inspector connects their Google account.
        </p>
      )}

      {/* BYO credentials — hidden on SaaS when platform mode is selected */}
      {(!isSaas || oauthMode === "own") && (
        <div className="space-y-4 pt-2 border-t border-ih-border">
          <p className="text-[13px] text-ih-fg-3">
            Create OAuth credentials at{" "}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ih-primary hover:underline"
            >
              Google Cloud Console
            </a>
            . Redirect URI: <code className="text-[11px] font-mono">/api/calendar/callback</code>
          </p>
          <Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="save-calendar-secrets" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SecretField
                name="GOOGLE_CLIENT_ID"
                label="Google Client ID"
                value={secrets.GOOGLE_CLIENT_ID}
                error={secretFieldError("GOOGLE_CLIENT_ID")}
                hint="OAuth 2.0 Client ID from Google Cloud Console"
              />
              <SecretField
                name="GOOGLE_CLIENT_SECRET"
                label="Google Client Secret"
                value={secrets.GOOGLE_CLIENT_SECRET}
                error={secretFieldError("GOOGLE_CLIENT_SECRET")}
                hint="Paired with the Client ID above"
              />
            </div>
            {secretFormError("save-calendar-secrets") &&
              !secretFieldError("GOOGLE_CLIENT_ID") &&
              !secretFieldError("GOOGLE_CLIENT_SECRET") && (
                <p className="text-[12px] text-ih-bad-fg">{secretFormError("save-calendar-secrets")}</p>
              )}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingCalendarSecrets}
                className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60"
              >
                {savingCalendarSecrets ? "Saving…" : "Save credentials"}
              </button>
            </div>
          </Form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        {/* Google Calendar */}
        <div className="p-4 border border-ih-border rounded-lg space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-ih-primary-tint flex items-center justify-center">
              <CalendarIcon className="w-4 h-4 text-ih-primary" />
            </div>
            <div>
              <p className="text-[13px] font-bold text-ih-fg-1">Google Calendar</p>
              <p className="text-[11px] text-ih-fg-3">Per-inspector OAuth sync</p>
            </div>
          </div>

          {googleCalendarConnected ? (
            <div className="space-y-2">
              <span className="inline-flex items-center rounded-ih-pill px-2 py-0.5 text-[11px] font-bold bg-ih-ok-bg text-ih-ok-fg">
                Connected
              </span>
              {googleCalendarCapability && (
                <p className="text-[11px] text-ih-fg-3">
                  Access: {CAPABILITY_LABELS[googleCalendarCapability]}
                </p>
              )}
              <Form method="post">
                <input type="hidden" name="intent" value="disconnect-calendar" />
                <button
                  type="submit"
                  disabled={disconnectingCalendar}
                  className="h-8 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-60"
                >
                  {disconnectingCalendar ? "Disconnecting…" : "Disconnect"}
                </button>
              </Form>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] text-ih-fg-3">Choose what Google may access:</p>
              <div className="flex flex-col gap-2">
                {(["availability_read", "events_read_write"] as const).map((cap) => (
                  <label
                    key={cap}
                    className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer text-[12px] ${
                      capability === cap
                        ? "border-ih-primary bg-ih-primary/5 text-ih-fg-1"
                        : "border-ih-border text-ih-fg-2"
                    }`}
                  >
                    <input
                      type="radio"
                      name="calendarCapability"
                      value={cap}
                      checked={capability === cap}
                      onChange={() => setCapability(cap)}
                      className="h-3.5 w-3.5"
                    />
                    {CAPABILITY_LABELS[cap]}
                  </label>
                ))}
              </div>
              <GoogleSignInButton
                href={connectHref}
                label="Continue with Google"
                disabled={!canConnect}
              />
              {!canConnect && (
                <p className="text-[11px] text-ih-fg-3">
                  {isSaas && oauthMode === "platform"
                    ? "Platform Google OAuth is not configured on this deployment. Contact support."
                    : "Save your Google OAuth credentials above before connecting."}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Apple Calendar (ICS) */}
        <div className="p-4 border border-ih-border rounded-lg">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-ih-bg-muted flex items-center justify-center">
              <CalendarIcon className="w-4 h-4 text-ih-fg-3" />
            </div>
            <div>
              <p className="text-[13px] font-bold text-ih-fg-1">Apple Calendar</p>
              <p className="text-[11px] text-ih-fg-3">Read-only ICS feed</p>
            </div>
          </div>
          {icsUrl ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={icsUrl}
                className="flex-1 h-8 px-2 rounded-md border border-ih-border bg-ih-bg-muted text-[11px] font-mono text-ih-fg-3 outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(icsUrl);
                }}
                className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0"
              >
                Copy
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-ih-fg-3">ICS feed URL will appear once calendar sync is configured.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}
