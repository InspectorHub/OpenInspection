import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from '../shared.schema';
import { isValidTimeZone } from '../../tz';
import { isValidLocale } from '../../locale';
import { DATE_FORMATS, TIME_FORMATS } from '../../session/display-prefs';

/**
 * One rung of the cancellation ladder.
 *
 * A discriminated union, not `{ type, value }`: a bare `value` on a money field
 * carries no unit, so the same 50 is half the price in one arm and fifty cents
 * in the other and nothing objects. Split, "a percent above 100" is a range on
 * a field that only exists in the percent arm — the schema rejects it, and a
 * caller cannot even construct the nonsense in a typed client.
 */
const CancellationFeeSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('percent').describe('Fee expressed as a share of the inspection price.'),
        percent: z.number().min(0).max(100).describe('0-100. Of the PRICE; the resolver caps the charge at what was collected.'),
    }),
    z.object({
        type: z.literal('fixed').describe('Fee expressed as a fixed amount.'),
        amountCents: z.number().int().min(0).describe('Integer cents.'),
    }),
]).openapi('CancellationFee');

/**
 * The ladder itself. Hours only in v1 — see the column comment for why
 * "2 business days" is deferred rather than approximated.
 */
export const CancellationPolicySchema = z.object({
    noticeHours: z.number().int().min(0).max(720).openapi({ example: 24 })
        .describe('Notice threshold in hours. Cancelling with at least this much notice is free.'),
    lateFee: CancellationFeeSchema.describe('Charged when the client cancels inside the notice window.'),
    noShowFee: CancellationFeeSchema.describe('Charged when the client does not show. Commonly 100%.'),
    remedy: z.literal('refund').describe("Cash refund. 'credit' toward a future inspection is deferred."),
}).openapi('CancellationPolicy');

/**
 * Validation schema for the branding configuration update.
 */
export const UpdateBrandingSchema = z.object({
    companyName: z.string().min(1, 'Company name is required').max(50).optional().openapi({ example: 'My Inspection Pro' }).describe('TODO describe companyName field for the OpenInspection MCP integration'),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional().openapi({ example: '#4f46e5' }).describe('TODO describe primaryColor field for the OpenInspection MCP integration'),
    supportEmail: z.string().email('Invalid email address').optional().openapi({ example: 'support@example.com' }).describe('TODO describe supportEmail field for the OpenInspection MCP integration'),
    billingUrl: z.string().url('Invalid URL').or(z.literal('')).optional().openapi({ example: 'https://example.com/billing' }).describe('TODO describe billingUrl field for the OpenInspection MCP integration'),
    defaultProfileId: z.string().optional().openapi({ example: 'signature' }).describe('Default report appearance profile id (built-in: signature|meridian|terra)'),
    // Sprint 2 S2-4 — gate the per-defect "Estimated cost: $X – $Y" badge.
    showEstimates: z.boolean().optional().openapi({ example: true }).describe('TODO describe showEstimates field for the OpenInspection MCP integration'),
    // Track E1 (ITB §11) — gate the "Repair List" tab on the published report.
    enableRepairList: z.boolean().optional().openapi({ example: true }).describe('TODO describe enableRepairList field for the OpenInspection MCP integration'),
    // Sprint 3 S3-2 — gate the customer-driven "Generate repair request"
    // export link on the published report. Independent of enableRepairList.
    enableCustomerRepairExport: z.boolean().optional().openapi({ example: true }).describe('TODO describe enableCustomerRepairExport field for the OpenInspection MCP integration'),
    // Round-2 backlog #10 — tenant-wide default for the per-inspection
    // paywall introduced in Sprint 1 D-7 (ReportGatePage). When true, every
    // newly created inspection inherits paymentRequired=true. Per-inspection
    // override remains the source of truth at gate time.
    blockUnpaid: z.boolean().optional().openapi({ example: false }).describe('TODO describe blockUnpaid field for the OpenInspection MCP integration'),
    // Round-2 backlog #10 — tenant-wide default for the per-inspection
    // agreement gate. When true, every newly created inspection inherits
    // agreementRequired=true.
    blockUnsignedAgreement: z.boolean().optional().openapi({ example: false }).describe('TODO describe blockUnsignedAgreement field for the OpenInspection MCP integration'),
    // Round-2 backlog G3 (Spectora §4.1) — extra referral-source labels the
    // tenant wants on the inspection settings dropdown. The seed list of
    // seven values (Realtor / Past Client / …) is hardcoded; this array
    // appends to it. Trimmed entries; max 32 to keep the dropdown usable.
    customReferralSources: z.array(z.string().min(1).max(50)).max(32).optional().openapi({ example: ['Magazine ad', 'Trade show'] }).describe('TODO describe customReferralSources field for the OpenInspection MCP integration'),
    // Workers Paid PDF pipeline opt-in. Default OFF.
    enablePdfPipeline: z.boolean().optional().openapi({ example: false }).describe('TODO describe enablePdfPipeline field for the OpenInspection MCP integration'),
    // Report PDF print-layout settings. companyAddress is shown
    // in the PDF footer/header; the three booleans gate footer / page-number /
    // inspector-license rendering. All default ON when unset.
    companyAddress: z.string().max(300, 'Company address is too long').or(z.literal('')).nullable().optional().openapi({ example: '123 Main St, Springfield, IL' }).describe('Company mailing address rendered in the report PDF footer/header block.'),
    pdfShowFooter: z.boolean().optional().openapi({ example: true }).describe('When true, the report PDF renders the company footer block.'),
    pdfShowPageNumbers: z.boolean().optional().openapi({ example: true }).describe('When true, the report PDF renders page numbers.'),
    pdfShowLicense: z.boolean().optional().openapi({ example: true }).describe('When true, the report PDF renders the inspector license number.'),
    // Tenant display timezone (IANA name). Anchors reports, reminders, and
    // calendar events. Validated to a resolvable IANA id; UI constrains it to a
    // <select> of Intl.supportedValuesOf('timeZone').
    defaultTimezone: z.string().refine(isValidTimeZone, 'Invalid timezone').optional().openapi({ example: 'America/New_York' }).describe('Tenant default IANA timezone.'),
    // Tenant default display locale (BCP-47). Drives date/time/number/currency
    // formatting (and later UI language). Validated to a canonicalizable tag;
    // the UI constrains it to a <select> of the supported LOCALE_OPTIONS.
    defaultLocale: z.string().refine((v) => v === '' || isValidLocale(v), 'Invalid locale').optional().openapi({ example: 'es-419' }).describe('Tenant default display locale (BCP-47).'),
    // Tenant transaction/display currency (ISO 4217). Constrained to the
    // supported set; tenant-scoped only (no per-user override).
    currency: z.enum(['USD']).optional().openapi({ example: 'USD' }).describe('Tenant currency (ISO 4217).'),
    // #270 — date/time SHAPE, a separate axis from `defaultLocale`: the locale
    // decides what language "September" is written in, these decide whether the
    // day comes before it and whether 14:30 is spelled 2:30 PM. Tenant-level and
    // NOT nullable — this is the bottom of the resolution chain. `.optional()`
    // with no `.default()`: a default would make an omitted key overwrite a
    // stored preference the caller never mentioned.
    dateFormat: z.enum(DATE_FORMATS).optional().openapi({ example: 'us' }).describe('Tenant default date order (us|iso|eu).'),
    timeFormat: z.enum(TIME_FORMATS).optional().openapi({ example: '12h' }).describe('Tenant default clock (12h|24h).'),
    // IA-100 — whether archiving a contact also revokes the report links they
    // still hold. Off by default; see the column comment for why archiving is
    // treated as list hygiene rather than offboarding.
    archiveRevokesAccess: z.boolean().optional().openapi({ example: false }).describe('Archiving a contact also revokes their live report links.'),
    // Phase B — transient (NOT persisted) acknowledgement that the caller accepts
    // changing the tenant currency while invoices already exist. Without it the
    // save is blocked (409 CURRENCY_CHANGE_NEEDS_CONFIRM); existing invoices keep
    // their snapshot currency, new ones use the new tenant currency.
    confirmCurrencyChange: z.boolean().optional().openapi({ example: true }).describe('Acknowledge changing tenant currency with invoices present.'),
    // The cancellation ladder. `null` clears it back to "no policy configured",
    // which is where every workspace starts and where nothing is ever charged.
    // `.optional()` with NO `.default()`: a default here would make a save that
    // never mentions the policy silently overwrite a configured one.
    //
    // A fee-bearing policy is REFUSED unless the attestation below is on file
    // and still matches. That check reads DB state, so it is not expressible
    // here — it lives in `BrandingService.updateBranding`.
    cancellationPolicy: CancellationPolicySchema.nullable().optional()
        .describe('Cancellation ladder; null clears it. Fees require an attested agreement clause.'),
    // Transient (NOT a column): the id of the agreement template the tenant
    // confirms contains their cancellation clause. Sending it stamps the
    // attestation at that template's CURRENT version; sending null withdraws it.
    // Applied BEFORE the policy in the same request, so enabling fees and
    // attesting can be one save.
    attestCancellationClause: z.string().min(1).nullable().optional()
        .describe("Agreement template id the tenant attests contains their cancellation clause; null withdraws it."),
}).openapi('UpdateBranding');

/**
 * Body schema for inspector-facing PUT /api/admin/stripe-connect.
 * Validates the account ID matches Stripe's `acct_*` format.
 */
export const StripeConnectAccountSchema = z.object({
    accountId: z.string().regex(/^acct_[a-zA-Z0-9]{10,}$/, 'Invalid Stripe account ID — must look like acct_xxxxx').openapi({ example: 'acct_1AbCdEfGhIjKlMnO' }).describe('TODO describe accountId field for the OpenInspection MCP integration'),
}).openapi('StripeConnectAccount');

export const BrandingResponseSchema = createApiResponseSchema(z.object({
    branding: z.object({
        companyName: z.string().describe('TODO describe companyName field for the OpenInspection MCP integration'),
        primaryColor: z.string().describe('TODO describe primaryColor field for the OpenInspection MCP integration'),
        logoUrl: z.string().nullable().describe('TODO describe logoUrl field for the OpenInspection MCP integration'),
        supportEmail: z.string().describe('TODO describe supportEmail field for the OpenInspection MCP integration'),
        billingUrl: z.string().nullable().describe('TODO describe billingUrl field for the OpenInspection MCP integration'),
        defaultTimezone: z.string().describe('Tenant default IANA timezone (e.g. America/New_York); UTC when unset.'),
        defaultLocale: z.string().describe('Tenant default display locale (BCP-47, e.g. es-419); en-US when unset.'),
        currency: z.string().describe('Tenant currency (ISO 4217, e.g. USD); USD when unset.'),
        dateFormat: z.string().describe('Tenant default date order (us|iso|eu); us when unset.'),
        timeFormat: z.string().describe('Tenant default clock (12h|24h); 12h when unset.'),
        archiveRevokesAccess: z.boolean().optional()
            .describe('Whether archiving a contact also revokes the report links they still hold. False by default: archiving is list hygiene, not offboarding.'),
    }).describe('TODO describe branding field for the OpenInspection MCP integration'),
})).openapi('BrandingResponse');

// handoff-decisions §1 — attention thresholds (in hours, 1..720 = 30 days max)
export const AttentionThresholdsSchema = z.object({
    agreement_unsigned_h: z.number().int().min(1).max(720).describe('TODO describe agreement_unsigned_h field for the OpenInspection MCP integration'),
    invoice_overdue_h:    z.number().int().min(1).max(720).describe('TODO describe invoice_overdue_h field for the OpenInspection MCP integration'),
    report_unpublished_h: z.number().int().min(1).max(720).describe('TODO describe report_unpublished_h field for the OpenInspection MCP integration'),
}).openapi('AttentionThresholds');

export const AttentionThresholdsResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.object({ thresholds: AttentionThresholdsSchema.describe('TODO describe thresholds field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
}).openapi('AttentionThresholdsResponse');

export const ATTENTION_THRESHOLDS_DEFAULTS = {
    agreement_unsigned_h: 72,
    invoice_overdue_h:    72,
    report_unpublished_h: 72,
} as const;

// Round-2 backlog #2 (Spectora §5.1 / §E.7) — per-tenant default for the
// inspection dashboard column visibility set. The actual id whitelist lives
// in server/lib/dashboard-columns.ts; we constrain length here so a malicious
// payload can't blow up the JSON envelope, but accept any string id and
// drop unknown ones server-side via `normalizeDashboardColumns`.
export const DashboardColumnPrefsSchema = z.object({
    columns: z.array(z.string().min(1).max(64)).max(64)
        .openapi({ example: ['propertyAddress', 'clientName', 'date', 'price'] }).describe('TODO describe columns field for the OpenInspection MCP integration'),
}).openapi('DashboardColumnPrefs');

export const DashboardColumnPrefsResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.object({ columns: z.array(z.string()).describe('TODO describe columns field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
}).openapi('DashboardColumnPrefsResponse');
