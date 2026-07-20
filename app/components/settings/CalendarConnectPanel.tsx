import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator, useSearchParams } from "react-router";
import { RadioCardGroup } from "@core/shared-ui";
import { GoogleSignInButton } from "~/components/GoogleSignInButton";
import { CalendarGlyph } from "~/components/settings/CalendarGlyph";
import { calendarOAuthErrorToast } from "~/lib/calendar-oauth-errors";
import {
  listenCalendarOAuthPopup,
  openCalendarOAuthPopup,
} from "~/lib/calendar-oauth-popup";
import { pushToast } from "~/hooks/useToast";
import {
  CalendarReadSetPicker,
  type CalendarPickerData,
} from "~/components/settings/CalendarReadSetPicker";
import type { action } from "~/routes/settings-schedule";
import { m } from "~/paraglide/messages";

export type CalendarCapability = "availability_read" | "events_read_write";

export function CalendarConnectPanel({
  connected,
  capability: connectedCapability,
  oauthConfigured,
  disabled = false,
  picker = null,
}: {
  connected: boolean;
  capability: CalendarCapability | null;
  oauthConfigured: boolean;
  disabled?: boolean;
  picker?: CalendarPickerData | null;
}) {
  const CAPABILITY_LABELS: Record<CalendarCapability, string> = {
    availability_read: m.settings_calconnect_cap_availability(),
    events_read_write: m.settings_calconnect_cap_full(),
  };
  const [capability, setCapability] = useState<CalendarCapability>("events_read_write");
  const [connecting, setConnecting] = useState(false);
  const popupPollRef = useRef<number | null>(null);
  const syncFetcher = useFetcher<typeof action>();
  const disconnectFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const connectHref = `/api/calendar/connect?capability=${capability}&provider=google`;

  useEffect(() => {
    return listenCalendarOAuthPopup({
      onConnected: () => {
        if (popupPollRef.current !== null) {
          window.clearInterval(popupPollRef.current);
          popupPollRef.current = null;
        }
        setConnecting(false);
        pushToast({ message: m.settings_calconnect_connected_toast(), variant: "success", durationMs: 4000 });
        revalidator.revalidate();
      },
      onError: (message) => {
        if (popupPollRef.current !== null) {
          window.clearInterval(popupPollRef.current);
          popupPollRef.current = null;
        }
        setConnecting(false);
        const toast = calendarOAuthErrorToast(message);
        pushToast({ message: toast.message, variant: toast.variant, durationMs: 5000 });
      },
    });
  }, [revalidator]);

  useEffect(() => {
    const calendar = searchParams.get("calendar");
    const calendarError = searchParams.get("calendar_error");
    if (!calendar && !calendarError) return;

    const next = new URLSearchParams(searchParams);
    next.delete("calendar");
    next.delete("calendar_error");
    setSearchParams(next, { replace: true });

    if (calendar === "connected") {
      pushToast({ message: m.settings_calconnect_connected_toast(), variant: "success", durationMs: 4000 });
      revalidator.revalidate();
    } else if (calendarError) {
      const toast = calendarOAuthErrorToast(calendarError);
      pushToast({ message: toast.message, variant: toast.variant, durationMs: 5000 });
    }
  }, [searchParams, setSearchParams, revalidator]);

  useEffect(() => {
    if (
      disconnectFetcher.state === "idle" &&
      disconnectFetcher.data?.intent === "calendar-disconnect" &&
      disconnectFetcher.data.ok
    ) {
      revalidator.revalidate();
    }
  }, [disconnectFetcher.state, disconnectFetcher.data, revalidator]);

  useEffect(() => {
    return () => {
      if (popupPollRef.current !== null) window.clearInterval(popupPollRef.current);
    };
  }, []);

  const handleConnect = useCallback(() => {
    setConnecting(true);
    const popup = openCalendarOAuthPopup(connectHref);
    if (!popup) {
      window.location.href = connectHref;
      return;
    }

    if (popupPollRef.current !== null) window.clearInterval(popupPollRef.current);
    popupPollRef.current = window.setInterval(() => {
      if (!popup.closed) return;
      if (popupPollRef.current !== null) {
        window.clearInterval(popupPollRef.current);
        popupPollRef.current = null;
      }
      setConnecting(false);
    }, 400);
  }, [connectHref]);

  const syncing = syncFetcher.state !== "idle";
  const disconnecting = disconnectFetcher.state !== "idle";
  const syncResult =
    syncFetcher.state === "idle" && syncFetcher.data?.intent === "calendar-sync"
      ? syncFetcher.data
      : null;

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-ih-primary-tint flex items-center justify-center">
          <CalendarGlyph className="w-5 h-5 text-ih-primary" />
        </div>
        <div>
          <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
            {m.settings_calconnect_heading()}
          </h3>
          <p className="text-[12px] text-ih-fg-3">
            {m.settings_calconnect_desc()}
          </p>
        </div>
      </div>

      {disabled ? (
        <p className="text-[12px] text-ih-fg-3 bg-ih-bg-muted border border-ih-border rounded-md p-3">
          {m.settings_calconnect_personal_note()}
        </p>
      ) : connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-ih-pill px-2 py-0.5 text-[11px] font-bold bg-ih-ok-bg text-ih-ok-fg">
              {m.settings_conn_status_connected()}
            </span>
            {connectedCapability && (
              <span className="text-[11px] text-ih-fg-3">
                {CAPABILITY_LABELS[connectedCapability]}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={syncing}
              onClick={() => syncFetcher.submit({ intent: "calendar-sync" }, { method: "post" })}
              className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60"
            >
              {syncing ? m.settings_calconnect_syncing() : m.settings_calconnect_sync_now()}
            </button>
            <button
              type="button"
              disabled={disconnecting}
              onClick={() =>
                disconnectFetcher.submit({ intent: "calendar-disconnect" }, { method: "post" })
              }
              className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-60"
            >
              {disconnecting ? m.settings_calconnect_disconnecting() : m.settings_calconnect_disconnect()}
            </button>
          </div>
          {syncResult && (
            <p
              role={syncResult.ok ? "status" : "alert"}
              className={`text-[11px] ${syncResult.ok ? "text-ih-ok-fg" : "text-ih-bad-fg"}`}
            >
              {syncResult.ok
                ? m.settings_calconnect_sync_complete({ count: syncResult.totalEvents ?? 0 })
                : syncResult.message ?? m.settings_calconnect_sync_failed()}
            </p>
          )}
          {picker && <CalendarReadSetPicker picker={picker} />}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[12px] text-ih-fg-3">{m.settings_calconnect_choose_access()}</p>
          <RadioCardGroup
            name="calendarCapability"
            value={capability}
            onChange={(v) => setCapability(v as CalendarCapability)}
            options={[
              {
                value: "availability_read",
                title: CAPABILITY_LABELS.availability_read,
              },
              {
                value: "events_read_write",
                title: CAPABILITY_LABELS.events_read_write,
              },
            ]}
          />
          <GoogleSignInButton
            onClick={handleConnect}
            label={connecting ? m.settings_calconnect_connecting() : m.settings_calconnect_continue_google()}
            disabled={!oauthConfigured || connecting}
          />
          {!oauthConfigured && (
            <p className="text-[11px] text-ih-fg-3">
              {m.settings_calconnect_oauth_not_configured()}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
