import { useState } from "react";
import { Form, Link } from "react-router";
import { SegmentedControl } from "@core/shared-ui";
import { SecretField } from "~/components/SecretField";
import { m } from "~/paraglide/messages";

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
        {m.settings_gcal_heading()}
      </h3>

      <div className="rounded-md border border-ih-border bg-ih-primary-tint p-3 text-[13px] text-ih-fg-2">
        {m.settings_gcal_inspectors_connect_prefix()}{" "}
        <Link to="/settings/schedule" className="font-bold text-ih-primary hover:underline">
          {m.settings_gcal_my_schedule()}
        </Link>
        .
      </div>

      {isSaas ? (
        <div className="space-y-2">
          <SegmentedControl
            ariaLabel={m.settings_gcal_heading()}
            value={oauthMode}
            onChange={(v) => setOauthMode(v as GoogleOAuthMode)}
            options={[
              { value: "platform", label: m.settings_gcal_mode_platform() },
              { value: "own", label: m.settings_gcal_mode_own() },
            ]}
          />
          {/* No hidden input here: the toggle radios were never inside the
              form. The save Form below carries the value via its own
              hidden `googleOAuthMode` input. */}
          <p className="text-[11px] text-ih-fg-4">
            {oauthMode === "platform"
              ? m.settings_gcal_mode_platform_desc()
              : m.settings_gcal_mode_own_desc()}
          </p>
          <Form method="post" className="flex justify-end">
            <input type="hidden" name="intent" value="save-google-oauth-mode" />
            <input type="hidden" name="googleOAuthMode" value={oauthMode} />
            <button
              type="submit"
              disabled={savingOAuthMode || oauthMode === googleOAuthMode}
              className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-50"
            >
              {savingOAuthMode ? m.common_saving() : m.settings_gcal_save_oauth_mode()}
            </button>
          </Form>
        </div>
      ) : (
        <p className="text-[13px] text-ih-fg-3 bg-ih-bg-muted border border-ih-border rounded-md p-3">
          {m.settings_gcal_selfhost_note()}
        </p>
      )}

      {(!isSaas || oauthMode === "own") && (
        <div className="space-y-4 pt-2 border-t border-ih-border">
          <p className="text-[13px] text-ih-fg-3">
            {m.settings_gcal_create_prefix()}{" "}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ih-primary hover:underline"
            >
              {m.settings_gcal_cloud_console()}
            </a>
            {m.settings_gcal_redirect_uri()} <code className="text-[11px] font-mono">/api/calendar/callback</code>
          </p>
          <Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="save-calendar-secrets" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SecretField
                name="GOOGLE_CLIENT_ID"
                label={m.settings_gcal_client_id_label()}
                value={secrets.GOOGLE_CLIENT_ID}
                error={secretFieldError("GOOGLE_CLIENT_ID")}
                hint={m.settings_gcal_client_id_hint()}
              />
              <SecretField
                name="GOOGLE_CLIENT_SECRET"
                label={m.settings_gcal_client_secret_label()}
                value={secrets.GOOGLE_CLIENT_SECRET}
                error={secretFieldError("GOOGLE_CLIENT_SECRET")}
                hint={m.settings_gcal_client_secret_hint()}
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
                {savingCalendarSecrets ? m.common_saving() : m.settings_gcal_save_credentials()}
              </button>
            </div>
          </Form>
        </div>
      )}
    </section>
  );
}
