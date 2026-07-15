/**
 * Minimal HTML landing for Google Calendar OAuth callback.
 * Notifies the opener via postMessage (popup flow) or redirects (full-page fallback).
 */

export const CALENDAR_OAUTH_MESSAGE = {
    CONNECTED: 'oi:calendar-oauth:connected',
    ERROR: 'oi:calendar-oauth:error',
} as const;

export type CalendarOAuthPopupPayload =
    | { type: typeof CALENDAR_OAUTH_MESSAGE.CONNECTED }
    | { type: typeof CALENDAR_OAUTH_MESSAGE.ERROR; error: string };

const SETTINGS_COMMUNICATION = '/settings/communication';

export function calendarOAuthFallbackUrl(payload: CalendarOAuthPopupPayload): string {
    if (payload.type === CALENDAR_OAUTH_MESSAGE.CONNECTED) {
        return `${SETTINGS_COMMUNICATION}?calendar=connected`;
    }
    return `${SETTINGS_COMMUNICATION}?calendar_error=${encodeURIComponent(payload.error)}`;
}

export function renderCalendarOAuthPopupLanding(
    payload: CalendarOAuthPopupPayload,
    fallbackUrl: string = calendarOAuthFallbackUrl(payload),
): string {
    const payloadJson = JSON.stringify(payload);
    const fallbackJson = JSON.stringify(fallbackUrl);
    const title = payload.type === CALENDAR_OAUTH_MESSAGE.CONNECTED
        ? 'Google Calendar connected'
        : 'Google Calendar connection failed';
    const bodyCopy = payload.type === CALENDAR_OAUTH_MESSAGE.CONNECTED
        ? 'Connected successfully. You can close this window.'
        : 'Connection could not be completed. You can close this window and try again.';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f8f7f5; color: #1a1a1a; }
    main { text-align: center; padding: 2rem; max-width: 20rem; }
    p { font-size: 0.875rem; line-height: 1.5; color: #5c5c5c; }
  </style>
</head>
<body>
  <main>
    <p>${bodyCopy}</p>
  </main>
  <script>
(function () {
  var payload = ${payloadJson};
  var fallback = ${fallbackJson};
  if (window.opener && !window.opener.closed) {
    try { window.opener.postMessage(payload, window.location.origin); } catch (e) {}
    window.close();
    setTimeout(function () { window.location.replace(fallback); }, 400);
  } else {
    window.location.replace(fallback);
  }
})();
  </script>
</body>
</html>`;
}
