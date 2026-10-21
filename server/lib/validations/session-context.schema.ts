import { z } from '@hono/zod-openapi';
import { DATE_FORMATS, TIME_FORMATS } from '../session/display-prefs';
import { resolvedCapabilitySchema } from './admin/compliance';

/**
 * Response of `GET /api/session/context`: what the signed-in layout needs to render.
 *
 * Declared from what the handler returns, field for field. The native app calls this route, so a
 * field may be added here but never removed or narrowed.
 */
const BrandingSchema = z.object({
    companyName: z.string().describe('Company name from the stored settings, falling back to the platform default when none is saved.'),
    primaryColor: z.string().describe('Brand primary color as a CSS color string.'),
    logoUrl: z.string().nullable().describe('Company logo URL, or null when none is set.'),
    defaultProfileId: z.string().describe('Id of the default report profile.'),
    isSaas: z.boolean().describe('Whether this deployment is the hosted multi-company service.'),
    portalBaseUrl: z.string().nullable().describe('Base URL of the account portal, or null when the deployment has none.'),
    tenantSlug: z.string().nullable().describe('Company slug used in public links, or null when unknown.'),
    tenantStatus: z.string().describe('Company account status; active when nothing else applies.'),
    currentUserSlug: z.string().nullable().describe('Booking slug of the signed-in user, or null when they have none.'),
    bookingHost: z.string().nullable().describe('Host name that serves the public booking page, or null when not configured.'),
    privacyUrl: z.string().nullable().describe('Effective privacy policy URL for this company, or null without a company slug.'),
    termsUrl: z.string().nullable().describe('Effective terms URL for this company, or null without a company slug.'),
    defaultTimezone: z.string().describe('Company default display timezone as an IANA name; UTC when unset.'),
    holidayRegion: z.string().nullable().describe('Region the company works in, such as US or US-TX, or null when not stated.'),
    defaultLocale: z.string().describe('Company default display locale as a BCP-47 tag; en-US when unset.'),
    currency: z.string().describe('Company currency as an ISO 4217 code; USD when unset.'),
    archiveRevokesAccess: z.boolean().describe('Whether archiving a contact also revokes their report links.'),
    dateFormat: z.enum(DATE_FORMATS).describe('Company default date order: us, iso or eu.'),
    timeFormat: z.enum(TIME_FORMATS).describe('Company default clock: 12h or 24h.'),
});

const UserSchema = z.object({
    sessionMarker: z.string().describe('Opaque marker of this user, used by the browser to keep offline copies apart per user.'),
    name: z.string().nullable().describe('Display name of the signed-in user, or null when unreadable.'),
    email: z.string().nullable().describe('Email address of the signed-in user, or null when unreadable.'),
    role: z.string().describe('Role of the signed-in user; inspector when the token carries none.'),
    capabilities: resolvedCapabilitySchema()
        .describe('Resolved capability set for this user: role defaults with their own overrides applied.'),
    initials: z.string().describe('Up to two uppercase initials taken from the name; OI when there is no name.'),
    timezone: z.string().nullable().describe('Personal timezone override as an IANA name, or null to use the company default.'),
    locale: z.string().nullable().describe('Personal locale override as a BCP-47 tag, or null to use the company default.'),
    dateFormat: z.enum(DATE_FORMATS).nullable().describe('Personal date order override, or null to use the company default.'),
    timeFormat: z.enum(TIME_FORMATS).nullable().describe('Personal clock override, or null to use the company default.'),
});

const DeploymentSchema = z.object({
    mode: z.string().describe('Deployment mode, such as standalone or saas.'),
    hasBilling: z.boolean().describe('Whether this deployment runs subscription billing.'),
    hasSeatQuota: z.boolean().describe('Whether this deployment enforces a member seat limit.'),
    mcpEnabled: z.boolean().describe('Whether the remote MCP server is switched on.'),
    connectedAppsEnabled: z.boolean().describe('Whether connected applications can be granted access and listed.'),
    videoBackendManaged: z.boolean().describe('Whether video storage is managed by the platform.'),
    hasManagedCompliance: z.boolean().describe('Whether managed messaging compliance is available.'),
    hasAssistedMigration: z.boolean().describe('Whether the import wizard may hand an unreadable file to a person.'),
});

export const SessionContextResponseSchema = z.object({
    success: z.literal(true).describe('Always true on success.'),
    data: z.object({
        branding: BrandingSchema.describe('Company branding and display defaults.'),
        user: UserSchema.describe('The signed-in user and their resolved capabilities.'),
        deployment: DeploymentSchema.describe('Deployment capabilities the interface may gate on.'),
        seatUsage: z.object({
            used: z.number().describe('Seats currently in use.'),
            limit: z.number().describe('Seats the plan allows.'),
        }).nullable().describe('Seat usage, or null when seats are not limited or could not be read.'),
        videoProvider: z.enum(['r2', 'stream']).describe('Video backend the editor should use for this company.'),
        outboundCoolingWindow: z.object({
            unlockAtMs: z.number().describe('Epoch milliseconds when the outbound cooling window closes.'),
            turnstileSiteKey: z.string().nullable().describe('Site key for the send challenge, or null when none is configured.'),
        }).nullable().describe('Open outbound cooling window, or null when none applies or it could not be read.'),
        collabEditing: z.boolean().describe('Whether collaborative editing is on for this company.'),
        unreadMessages: z.number().describe('Unread message count over what the caller may see.'),
    }).describe('Session context payload.'),
}).openapi('SessionContextResponse');
