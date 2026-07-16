import { useCallback, useEffect, useRef, useState } from "react";
import { Form, useRevalidator, useSearchParams } from "react-router";
import { SecretField } from "~/components/SecretField";
import { GoogleSignInButton } from "~/components/GoogleSignInButton";
import { CalendarGlyph } from "~/components/settings/CalendarGlyph";
import { InspectionCalendarPanel } from "~/components/settings/InspectionCalendarPanel";
import {
  listenCalendarOAuthPopup,
  openCalendarOAuthPopup,
} from "~/lib/calendar-oauth-popup";
import { calendarOAuthErrorToast } from "~/lib/calendar-oauth-errors";
import { pushToast } from "~/hooks/useToast";

type CalendarCapability = "availability_read" | "events_read_write";
type GoogleOAuthMode = "platform" | "own";

const CAPABILITY_LABELS: Record<CalendarCapability, string> = {
  availability_read: "Read availability only",
  events_read_write: "Full sync (read + write events)",
};

/**
 * Settings → Communication: Google Calendar OAuth sync.
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
  generatingIcsUrl,
  icsUrl,
  icsFormError,
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
  generatingIcsUrl: boolean;
  icsUrl: string | null;
  icsFormError: string | null;
}) {
  const [oauthMode, setOauthMode] = useState<GoogleOAuthMode>(isSaas ? googleOAuthMode : "own");
  const [capability, setCapability] = useState<CalendarCapability>("events_read_write");
  const [connecting, setConnecting] = useState(false);
  const popupPollRef = useRef<number | null>(null);
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();

  const ownCredsConfigured = Boolean(secrets.GOOGLE_CLIENT_ID?.trim());
  const canConnect = isSaas
    ? oauthMode === "platform"
      ? googleOAuthConfigured
      : ownCredsConfigured
    : googleOAuthConfigured || ownCredsConfigured;

  const connectHref = `/api/calendar/connect?capability=${capability}&provider=google`;

  useEffect(() => {
    return listenCalendarOAuthPopup({
      onConnected: () => {
        if (popupPollRef.current !== null) {
          window.clearInterval(popupPollRef.current);
          popupPollRef.current = null;
        }
        setConnecting(false);
        pushToast({
          message: "Google Calendar connected.",
          variant: "success",
          durationMs: 4000,
        });
        revalidator.revalidate();
      },
      onError: (message) => {
        if (popupPollRef.current !== null) {
          window.clearInterval(popupPollRef.current);
          popupPollRef.current = null;
        }
        setConnecting(false);
        const toast = calendarOAuthErrorToast(message);
        pushToast({
          message: toast.message,
          variant: toast.variant,
          durationMs: 5000,
        });
      },
    });
  }, [revalidator]);

  // Full-page fallback when the popup is blocked or on mobile without opener.
  useEffect(() => {
    const calendar = searchParams.get("calendar");
    const calendarError = searchParams.get("calendar_error");
    if (!calendar && !calendarError) return;

    const next = new URLSearchParams(searchParams);
    next.delete("calendar");
    next.delete("calendar_error");
    setSearchParams(next, { replace: true });

    if (calendar === "connected") {
      pushToast({
        message: "Google Calendar connected.",
        variant: "success",
        durationMs: 4000,
      });
      revalidator.revalidate();
    } else if (calendarError) {
      const toast = calendarOAuthErrorToast(calendarError);
      pushToast({
        message: toast.message,
        variant: toast.variant,
        durationMs: 5000,
      });
    }
  }, [searchParams, setSearchParams, revalidator]);

  const handleConnect = useCallback(() => {
    setConnecting(true);

    const popup = openCalendarOAuthPopup(connectHref);
    if (!popup) {
      window.location.href = connectHref;
      return;
    }

    if (popupPollRef.current !== null) {
      window.clearInterval(popupPollRef.current);
    }
    popupPollRef.current = window.setInterval(() => {
      if (!popup.closed) return;
      if (popupPollRef.current !== null) {
        window.clearInterval(popupPollRef.current);
        popupPollRef.current = null;
      }
      setConnecting(false);
    }, 400);
  }, [connectHref]);

  useEffect(() => {
    return () => {
      if (popupPollRef.current !== null) {
        window.clearInterval(popupPollRef.current);
      }
    };
  }, []);

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
              <CalendarGlyph className="w-4 h-4 text-ih-primary" />
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
                onClick={handleConnect}
                label={connecting ? "Connecting…" : "Continue with Google"}
                disabled={!canConnect || connecting}
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

        <InspectionCalendarPanel
          icsUrl={icsUrl}
          generatingIcsUrl={generatingIcsUrl}
          formError={icsFormError}
        />
      </div>
    </section>
  );
}
