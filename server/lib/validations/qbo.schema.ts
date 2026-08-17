import { z } from '@hono/zod-openapi';

/**
 * The shapes QuickBooks Online sends US, validated at the boundary.
 *
 * Every `describe()` here is published — this file feeds the OpenAPI document
 * Intuit reviews for the app listing. They previously all read
 * `TODO describe <field> field for the OpenInspection MCP integration`, an
 * auto-generated placeholder, which is worse than no description: it presents
 * as documentation and says nothing, so nobody notices it is missing.
 *
 * These describe INTUIT's contract, not our preferences. Where a field's meaning
 * came from a captured sandbox response rather than from Intuit's prose, the
 * comment says so — an assumption about an upstream shape that nobody wrote
 * down is how this integration accumulated nine paths that never worked.
 */

/**
 * One entry from an Intuit webhook payload, in CloudEvents form.
 *
 * Intuit posts an ARRAY of these to the webhook endpoint, so the handler
 * tolerates both a bare object and an array. Anything that fails this schema is
 * counted and logged rather than dropped silently: a shape change on Intuit's
 * side is otherwise indistinguishable from a quiet period, because both produce
 * a healthy-looking 200 that processed nothing.
 */
export const QBOCloudEventSchema = z.object({
    specversion: z.string()
        .describe('CloudEvents spec version the envelope conforms to, e.g. "1.0".'),
    id: z.string()
        .describe('Intuit\'s unique id for this event. Two deliveries carrying the same id are the same event — Intuit retries.'),
    source: z.string()
        .describe('The producing system, as a URI. Intuit sets this; it is recorded, not matched against.'),
    // The fourth segment is NOT described here on purpose. `parseCloudEventType`
    // requires it to exist and then never reads it, and no captured sandbox
    // event has been recorded to say what it carries. Naming it "version" would
    // be a guess published as documentation — the exact habit that put nine
    // never-working paths in this integration. Fill it in from a captured
    // payload, citing the capture, or leave it unstated.
    type: z.string()
        .describe('Dotted event type, parsed as qbo.<entity>.<operation>.<...>: at least four segments, the first being "qbo". The entity segment is what decides whether we act on the event — see `parseCloudEventType`.'),
    datacontenttype: z.string().optional()
        .describe('Media type of `data` when present, e.g. "application/json".'),
    time: z.string().optional()
        .describe('When Intuit emitted the event (RFC 3339). Not used for ordering: webhook arrival order is not guaranteed, so current state is re-fetched from the API rather than reconstructed from event sequence.'),
    intuitentityid: z.string()
        .describe('Id of the changed entity WITHIN the QuickBooks company — an Invoice Id, a Payment Id. Not globally unique: it is only meaningful together with `intuitaccountid`.'),
    intuitaccountid: z.string()
        .describe('The QuickBooks company (realm) id. This is what maps the event back to a tenant, via `qbo_connections.realm_id`; an event for a realm we hold no connection for is counted and skipped.'),
    data: z.record(z.string(), z.unknown()).optional()
        .describe('Optional event payload. Deliberately typed loosely and never trusted as the source of the entity\'s state — the handler re-fetches the entity from the API instead, because a webhook body cannot be assumed current by the time it is processed.'),
});

/** Response to `GET companyinfo/:realmId`, used to name the connected company in Settings. */
export const QBOCompanyInfoResponseSchema = z.object({
    CompanyInfo: z.object({
        CompanyName: z.string()
            .describe('The company name as it appears in QuickBooks. Shown in Settings so an owner can confirm which books they connected — the only human-readable check that the realm id is the one they meant.'),
    }).describe('QuickBooks company profile. Only the name is read; the rest of Intuit\'s object is ignored rather than modelled.'),
});

/**
 * Intuit's OAuth 2.0 token response, from both the authorization-code exchange
 * and the refresh grant.
 *
 * `expires_in` is deliberately NOT modelled: the access-token lifetime is
 * pinned to `ACCESS_TOKEN_TTL_SEC` so a missing or surprising value cannot
 * silently produce a token we believe is valid forever.
 */
export const QBOTokenResponseSchema = z.object({
    access_token: z.string()
        .describe('Bearer token for the accounting API. Encrypted before storage; never logged and never returned to a browser.'),
    refresh_token: z.string()
        .describe('Used to obtain the next access token. Intuit ROTATES this on most refreshes, so the value returned here replaces the stored one — keeping the old one is how a connection dies a day later.'),
    x_refresh_token_expires_in: z.number()
        .describe('Seconds until the REFRESH token expires (Intuit\'s vendor-prefixed field, not standard OAuth). This is the hard deadline after which the tenant must reauthorize; Settings warns ahead of it.'),
    token_type: z.string().optional()
        .describe('Always "bearer" in practice. Accepted and ignored.'),
});

/** Body of the link-an-existing-customer action in Settings → Integrations. */
export const QBOLinkCustomerBodySchema = z.object({
    qboCustomerId: z.string().min(1)
        .describe('Id of an existing QuickBooks customer to map this contact onto, instead of creating a new one. The customer is fetched before the mapping is written, so the stored SyncToken belongs to that customer rather than being assumed.'),
});

export type QBOCloudEvent = z.infer<typeof QBOCloudEventSchema>;
