/**
 * The QuickBooks OAuth mount point, and the redirect URI derived from it.
 *
 * Intuit matches `redirect_uri` byte-for-byte against the value registered on
 * the app — including casing, scheme, and any trailing slash — and it is sent
 * TWICE in one flow: once on the authorize redirect and again on the token
 * exchange. Two hand-written copies is one chance to drift, and the failure it
 * produces (`invalid_grant` at the exchange, after the user has already
 * approved) reads like a credential problem, not a string problem. So both
 * sides call `qboRedirectUri`, and the mount in `server/index.ts` plus the
 * `isPublic` entry in `jwt-auth.ts` come from the same constants — the path
 * cannot move without the URI moving with it.
 */
export const QBO_OAUTH_MOUNT = '/api/integrations/qbo';

/** Absolute path Intuit redirects the browser back to. */
export const QBO_CALLBACK_PATH = `${QBO_OAUTH_MOUNT}/callback`;

/** The exact string to register with Intuit, for a given public origin. */
export function qboRedirectUri(appBaseUrl: string): string {
    return `${appBaseUrl}${QBO_CALLBACK_PATH}`;
}

/** Intuit's "Disconnect URL": the public page QuickBooks sends a user to after they disconnect from their side. */
export const QBO_DISCONNECT_PAGE_PATH = '/integrations/quickbooks/disconnected';

/** Where Intuit delivers data-change notifications (mounted at the top level, never under /api/). */
export const QBO_WEBHOOK_PATH = '/webhooks/quickbooks';

/**
 * The three addresses an operator registers in their own Intuit app, for a
 * given public origin. They are different paths on purpose, and the settings
 * page shows them with a copy button each, so they come from here rather than
 * being typed a second time in a component.
 */
export function qboRegistrationUrls(appBaseUrl: string): {
    redirectUri: string;
    disconnectUrl: string;
    webhookUrl: string;
} {
    return {
        redirectUri: qboRedirectUri(appBaseUrl),
        disconnectUrl: `${appBaseUrl}${QBO_DISCONNECT_PAGE_PATH}`,
        webhookUrl: `${appBaseUrl}${QBO_WEBHOOK_PATH}`,
    };
}
