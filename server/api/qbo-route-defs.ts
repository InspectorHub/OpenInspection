import { createRoute, z } from '@hono/zod-openapi';
import { requireCapability } from '../lib/middleware/require-capability';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import {
    QboAckSchema,
    QboConnectionStatusSchema,
    QboCustomerRowSchema,
    QboErrorBodySchema,
} from '../lib/validations/qbo-admin.schema';

/**
 * Route definitions for the QuickBooks admin routes (mounted at /api/integrations/qbo). The router verifies the
 * session and requires owner or manager for every path under the prefix (see qbo.ts); each route adds the
 * `companyFinance` capability here, which is what `x-capability` declares.
 *
 * Only `status` and the contact-link read are exposed to MCP. The rest disconnect, pause or sync a third-party
 * account, call Intuit under the company's credentials, or write a mapping between a contact and a QuickBooks
 * customer, so they are `excluded`. The customer search and the link body are validated inside the handler (a
 * schema in front of it would change the error body), so neither declares a request schema.
 */
const idParam = z.object({ id: z.string().describe('Id of the sync row to dismiss.') });
const contactParam = z.object({ contactId: z.string().describe('Id of the contact whose QuickBooks match is addressed.') });
const err = (what: string) => ({ content: { 'application/json': { schema: QboErrorBodySchema } }, description: what });
const ok = <T extends z.ZodTypeAny>(schema: T, what: string) => ({ content: { 'application/json': { schema } }, description: what });
const success = z.literal(true).describe('Always true on success.');

export const qboStatusRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/status', tags: ['qbo'],
    middleware: [requireCapability('companyFinance')] as const,
    responses: { 200: ok(z.object({ success, data: QboConnectionStatusSchema.nullable().describe('The connection status, or null when QuickBooks is not connected.') }), 'Connection status') },
    operationId: 'getQboConnectionStatus', summary: 'Read the QuickBooks connection status',
    description: 'Reports the QuickBooks connection of the company: realm, company name, last sync, open sync rows, payment discrepancies and where each credential comes from (never the credential). Owner or manager with the companyFinance capability.',
}, { scopes: ['read'], tier: 'extended', capability: 'companyFinance' }));

export const qboDisconnectRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/disconnect', tags: ['qbo'],
    middleware: [requireCapability('companyFinance')] as const,
    responses: { 200: ok(QboAckSchema, 'Disconnected') },
    operationId: 'disconnectQbo', summary: 'Disconnect QuickBooks from the company',
    description: 'Revokes the Intuit refresh token and deletes the company mapping between invoices and QuickBooks invoices, which reconnecting does not restore. Owner or manager with the companyFinance capability.',
}, { scopes: [], tier: 'excluded', capability: 'companyFinance' }));

export const qboPauseRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/pause', tags: ['qbo'],
    middleware: [requireCapability('companyFinance')] as const,
    responses: {
        200: ok(z.object({ success, data: z.object({ syncEnabled: z.boolean().describe('The automatic sync setting after the toggle.') }).describe('The new setting.') }), 'Sync setting toggled'),
        404: err('QuickBooks is not connected'),
    },
    operationId: 'toggleQboSync', summary: 'Pause or resume the QuickBooks sync',
    description: 'Toggles automatic QuickBooks sync for the company and returns the new setting; 404 not_connected when there is no connection. Owner or manager with the companyFinance capability.',
}, { scopes: [], tier: 'excluded', capability: 'companyFinance' }));

export const qboSyncRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/sync', tags: ['qbo'],
    middleware: [requireCapability('companyFinance')] as const,
    responses: {
        200: ok(z.object({ success, data: z.object({
            processed: z.number().int().describe('Number of invoice payments the scan applied.'),
            checkedAt: z.number().int().describe('When the scan finished, as epoch seconds.'),
        }).describe('Outcome of the scan.') }), 'Scan finished'),
    },
    operationId: 'syncQboNow', summary: 'Check QuickBooks for invoice payments now',
    description: 'Runs one payment scan against QuickBooks and waits for it. Answers 409 when QuickBooks is not connected or the sync is paused, and 503 when QuickBooks does not respond. Owner or manager with the companyFinance capability.',
}, { scopes: [], tier: 'excluded', capability: 'companyFinance' }));

export const qboDismissErrorRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/errors/{id}/dismiss', tags: ['qbo'],
    middleware: [requireCapability('companyFinance')] as const,
    request: { params: idParam },
    responses: { 200: ok(QboAckSchema, 'Row closed') },
    operationId: 'dismissQboError', summary: 'Dismiss one open QuickBooks sync row',
    description: 'Marks one open QuickBooks sync row as resolved because a person has looked at it; nothing is retried. Owner or manager with the companyFinance capability.',
}, { scopes: [], tier: 'excluded', capability: 'companyFinance' }));

export const qboCustomersRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/customers', tags: ['qbo'],
    middleware: [requireCapability('companyFinance')] as const,
    responses: {
        200: ok(z.object({ success, data: z.object({
            customers: z.array(QboCustomerRowSchema).describe('Matching QuickBooks customers.'),
            nextStartPosition: z.number().int().nullable().describe('Start position of the next page, or null on the last page.'),
        }).describe('One page of matches.') }), 'Matching customers'),
        400: err('The query is not valid'),
    },
    operationId: 'searchQboCustomers', summary: 'Search QuickBooks customers by name or email',
    description: 'Searches the connected QuickBooks company for customers. Query parameters: q (2 to 100 characters), startPosition (1-based) and limit (1 to 20). Every call goes to Intuit and is rate limited per company. Owner or manager with the companyFinance capability.',
}, { scopes: [], tier: 'excluded', capability: 'companyFinance' }));

export const qboCredentialCheckRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/credentials/check', tags: ['qbo'],
    middleware: [requireCapability('companyFinance')] as const,
    responses: {
        200: ok(z.object({ success, data: z.object({
            result: z.enum(['paired', 'rejected', 'unreachable']).describe('Whether Intuit accepts the Client ID and Client Secret as one pair.'),
            environment: z.enum(['sandbox', 'production']).nullable().describe('Which Intuit host this deployment calls, or null when unset.'),
            checkedAt: z.number().int().describe('When the check finished, as epoch seconds.'),
        }).describe('The verdict.') }), 'Credential verdict'),
        400: err('Credentials or the application base URL are not configured'),
    },
    operationId: 'checkQboCredentials', summary: 'Check the QuickBooks Client ID and Secret',
    description: 'Asks Intuit whether the configured Client ID and Client Secret belong together. Nothing is connected or stored and the response carries the verdict only. Rate limited per company. Owner or manager with the companyFinance capability.',
}, { scopes: [], tier: 'excluded', capability: 'companyFinance' }));

export const qboContactLinkReadRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/contacts/{contactId}/link', tags: ['qbo'],
    middleware: [requireCapability('companyFinance')] as const,
    request: { params: contactParam },
    responses: {
        200: ok(z.object({ success, data: z.object({
            linked: z.boolean().describe('True when the contact is matched to a QuickBooks customer.'),
            qboCustomerId: z.string().nullable().describe('The matched QuickBooks customer id, or null.'),
            displayName: z.string().nullable().describe('The matched customer display name, or null.'),
            openErrorCount: z.number().int().describe('Number of open sync rows about this contact.'),
        }).describe('The match state of the contact.') }), 'Match state'),
    },
    operationId: 'getQboContactLink', summary: 'Read the QuickBooks match of a contact',
    description: 'Reports whether one contact is matched to a QuickBooks customer, which customer, and how many open sync rows concern the contact. Owner or manager with the companyFinance capability.',
}, { scopes: ['read'], tier: 'extended', capability: 'companyFinance' }));

export const qboContactLinkSetRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/contacts/{contactId}/link', tags: ['qbo'],
    middleware: [requireCapability('companyFinance')] as const,
    request: { params: contactParam },
    responses: {
        200: ok(z.object({ success, data: z.object({
            qboCustomerId: z.string().describe('The QuickBooks customer id now matched to the contact.'),
            displayName: z.string().describe('Display name of that customer.'),
            replacedQboCustomerId: z.string().nullable().describe('The customer the contact pointed at before, when it was a different one.'),
            resolvedErrorCount: z.number().int().describe('Number of open sync rows closed by the match.'),
        }).describe('The match that was written.') }), 'Match written'),
        400: err('The body is not valid'),
        401: err('No verified user behind the request'),
    },
    operationId: 'linkQboContact', summary: 'Match a contact to a QuickBooks customer',
    description: 'Matches one contact to an existing QuickBooks customer; the JSON body is {qboCustomerId} with a non-empty customer id. Safe to repeat. Invoices waiting for the match are pushed after the response. Owner or manager with the companyFinance capability.',
}, { scopes: [], tier: 'excluded', capability: 'companyFinance' }));

export const qboContactLinkRemoveRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/contacts/{contactId}/link', tags: ['qbo'],
    middleware: [requireCapability('companyFinance')] as const,
    request: { params: contactParam },
    responses: {
        200: ok(z.object({ success, data: z.object({ removed: z.boolean().describe('False when there was no match to remove.') }).describe('Outcome of the removal.') }), 'Match removed'),
        401: err('No verified user behind the request'),
    },
    operationId: 'unlinkQboContact', summary: 'Remove the QuickBooks match of a contact',
    description: 'Removes the match between one contact and a QuickBooks customer. Nothing is sent to QuickBooks and removing a match that is already gone answers removed false. Owner or manager with the companyFinance capability.',
}, { scopes: [], tier: 'excluded', capability: 'companyFinance' }));
