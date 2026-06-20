import { Form } from "react-router";
import { SecretField } from "~/components/SecretField";

/**
 * Settings → Communication: Google OAuth credentials + Calendar sync (Google +
 * Apple ICS) sections. Presentational — the route owns secret values, pending
 * state, the connected/ICS flags, and the error mappers.
 */
export function GoogleCalendarPanel({
  secrets,
  secretFieldError,
  secretFormError,
  savingCalendarSecrets,
  googleCalendarConnected,
  icsUrl,
}: {
  secrets: { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string };
  secretFieldError: (name: string) => string | undefined;
  secretFormError: (intent: string) => string | null;
  savingCalendarSecrets: boolean;
  googleCalendarConnected: boolean;
  icsUrl: string | null;
}) {
  return (
    <>
      {/* Google Calendar OAuth secrets */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Google OAuth credentials</h3>
        <p className="text-[13px] text-ih-fg-3">
          Required for Google Calendar two-way sync. Create credentials at{" "}
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-ih-primary hover:underline">Google Cloud Console</a>.
        </p>
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="save-calendar-secrets" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SecretField
              name="GOOGLE_CLIENT_ID"
              label="Google Client ID"
              value={secrets.GOOGLE_CLIENT_ID}
              error={secretFieldError("GOOGLE_CLIENT_ID")}
              hint="Enables Google Calendar sync. Create at console.cloud.google.com → APIs → OAuth 2.0"
            />
            <SecretField
              name="GOOGLE_CLIENT_SECRET"
              label="Google Client Secret"
              value={secrets.GOOGLE_CLIENT_SECRET}
              error={secretFieldError("GOOGLE_CLIENT_SECRET")}
              hint="Paired with Client ID above. Found in the same OAuth 2.0 credentials page"
            />
          </div>
          {secretFormError("save-calendar-secrets") &&
            !secretFieldError("GOOGLE_CLIENT_ID") &&
            !secretFieldError("GOOGLE_CLIENT_SECRET") && (
              <p className="text-[12px] text-ih-bad-fg">{secretFormError("save-calendar-secrets")}</p>
            )}
          <div className="flex justify-end pt-3 border-t border-ih-border">
            <button type="submit" disabled={savingCalendarSecrets}
              className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
              {savingCalendarSecrets ? "Saving…" : "Save credentials"}
            </button>
          </div>
        </Form>
      </section>

      {/* Calendar sync */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Calendar sync</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Google Calendar */}
          <div className="p-4 border border-ih-border rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-ih-primary-tint flex items-center justify-center">
                <CalendarIcon className="w-4 h-4 text-ih-primary" />
              </div>
              <div>
                <p className="text-[13px] font-bold text-ih-fg-1">Google Calendar</p>
                <p className="text-[11px] text-ih-fg-3">Two-way sync via OAuth</p>
              </div>
            </div>
            {googleCalendarConnected ? (
              <span className="text-[11px] font-bold text-ih-ok-fg">Connected</span>
            ) : (
              <button className="h-8 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors">
                Connect Google Calendar
              </button>
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
                  type="text" readOnly value={icsUrl}
                  className="flex-1 h-8 px-2 rounded-md border border-ih-border bg-ih-bg-muted text-[11px] font-mono text-ih-fg-3 outline-none"
                />
                <button
                  onClick={() => { void navigator.clipboard.writeText(icsUrl); }}
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
    </>
  );
}

/* Inline SVG icon */
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}
