import { useState } from "react";
import { Form, Link } from "react-router";
import { SecretField } from "~/components/SecretField";

type GoogleOAuthMode = "platform" | "own";

/**
 * Company-level Google OAuth app configuration.
 * Inspectors manage their personal calendar connections under My Schedule.
 */
export function GoogleCalendarPanel({
  isSaas,
  googleOAuthMode,
  secrets,
  secretFieldError,
  secretFormError,
  savingCalendarSecrets,
  savingOAuthMode,
}: {
  isSaas: boolean;
  googleOAuthConfigured: boolean;
  googleOAuthMode: GoogleOAuthMode;
  secrets: { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string };
  secretFieldError: (name: string) => string | undefined;
  secretFormError: (intent: string) => string | null;
  savingCalendarSecrets: boolean;
  savingOAuthMode: boolean;
}) {
  const [oauthMode, setOauthMode] = useState<GoogleOAuthMode>(isSaas ? googleOAuthMode : "own");

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
        Google Calendar OAuth app
      </h3>

      <div className="rounded-md border border-ih-border bg-ih-primary-tint p-3 text-[13px] text-ih-fg-2">
        Inspectors connect calendars under{" "}
        <Link to="/settings/schedule" className="font-bold text-ih-primary hover:underline">
          My Schedule
        </Link>
        .
      </div>

      {isSaas ? (
        <div className="space-y-2">
          <div className="inline-flex rounded-md border border-ih-border overflow-hidden">
            {(["platform", "own"] as const).map((mode) => (
              <label
                key={mode}
                className={`px-3 h-8 flex items-center text-[12px] font-bold cursor-pointer ${
                  oauthMode === mode ? "bg-ih-primary text-white" : "bg-ih-bg-card text-ih-fg-2"
                }`}
              >
                <input
                  type="radio"
                  name="_googleOAuthModeRadio"
                  value={mode}
                  checked={oauthMode === mode}
                  onChange={() => setOauthMode(mode)}
                  className="sr-only"
                />
                {mode === "platform" ? "Platform Google OAuth" : "My own OAuth app"}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-ih-fg-4">
            {oauthMode === "platform"
              ? "Use the hosted platform OAuth app for inspector connections."
              : "Use your company Google Cloud OAuth client."}
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
          Self-hosted deployments use their own Google Cloud OAuth app.
        </p>
      )}

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
                <p className="text-[12px] text-ih-bad-fg">
                  {secretFormError("save-calendar-secrets")}
                </p>
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
    </section>
  );
}
