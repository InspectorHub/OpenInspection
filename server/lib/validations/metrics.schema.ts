import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * An explicit civil-date window, replacing the former `period=3m|6m|12m` enum.
 * The enum could express only three windows and named them in the system's own
 * shorthand; a range says what it covers and lets a caller ask for "last week".
 * Both ends are inclusive and optional — an omitted end resolves server-side.
 */
const CivilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const MetricsQuerySchema = z.object({
    from: CivilDate.optional().describe('First day of the window (inclusive), YYYY-MM-DD. Defaults to three months before `to`.'),
    to:   CivilDate.optional().describe('Last day of the window (inclusive), YYYY-MM-DD. Defaults to today.'),
});

const MonthlyDataSchema = z.object({
    month:   z.string().describe('TODO describe month field for the OpenInspection MCP integration'),
    revenue: z.number().describe('TODO describe revenue field for the OpenInspection MCP integration'),
    count:   z.number().describe('TODO describe count field for the OpenInspection MCP integration'),
});

const TopAgentSchema = z.object({
    agentId:   z.string().nullable().describe('Contact id of the referrer; null for a free-text referral source.'),
    agentName: z.string().describe('Referrer name, or the free-text source when there is no contact row.'),
    // Two different KINDS of answer, deliberately not merged into one column:
    // `contact` is a real contact row, `source` is free text such as "Google".
    kind:      z.enum(['contact', 'source']).describe('Whether this row is keyed on a contact or on a free-text referral source.'),
    count:     z.number().describe('Inspections referred in the period.'),
    revenue:   z.number().describe('Effective price of the inspections they referred, in cents.'),
});

/**
 * Pay and attributed revenue are two figures with two labels, never one column
 * called "revenue": they differ by margin and the difference is the business.
 */
const ByInspectorSchema = z.object({
    inspectorId:            z.string().describe('User id of the inspector this row is about.'),
    inspectorName:          z.string().describe('Display name of the inspector, falling back to their id.'),
    ledCount:               z.number().describe('Inspections this person led in the period.'),
    assistedCount:          z.number().describe('Inspections this person assisted on in the period.'),
    payCents:               z.number().describe('What this inspector earns: the sum of their recorded pay split rows, in cents.'),
    attributedRevenueCents: z.number().nullable().describe('What the business billed for the lines they worked, in cents; null for a caller without the financial capability.'),
    medianTurnaroundDays:   z.number().nullable().describe('Median days from field completion to report publish, lead only; null when there is no basis.'),
    turnaroundBasis:        z.enum(['field_complete_to_report_published', 'no_data']).describe('Which clock the turnaround figure used, or no_data when none was available.'),
});

const ServiceDistributionSchema = z.object({
    serviceName: z.string().describe('TODO describe serviceName field for the OpenInspection MCP integration'),
    count:       z.number().describe('TODO describe count field for the OpenInspection MCP integration'),
    revenue:     z.number().describe('TODO describe revenue field for the OpenInspection MCP integration'),
});

const MetricsResponseSchema = z.object({
    /** Echoed back so a caller can tell what window the numbers actually cover. */
    from:             z.string().describe('First day the figures cover (inclusive), YYYY-MM-DD.'),
    to:               z.string().describe('Last day the figures cover (inclusive), YYYY-MM-DD.'),
    // `self` means the caller lacks the financial capability: byInspector holds
    // only their own row and every company figure is null. Null rather than
    // zero — zero would be a claim about the business.
    scope:            z.enum(['all', 'self']).describe('Whether the payload covers the company or only the caller.'),
    totalRevenue:     z.number().nullable().describe('Effective revenue over the window in cents; null without the financial capability.'),
    totalInspections: z.number().describe('Inspections in the window.'),
    avgOrderValue:    z.number().nullable().describe('Mean effective price per inspection in cents; null without the financial capability.'),
    monthly:          z.array(MonthlyDataSchema).describe('Monthly revenue and volume series; empty without the financial capability.'),
    topAgents:        z.array(TopAgentSchema).describe('Referrers by volume — contact-keyed rows first, then free-text sources; empty without the financial capability.'),
    byInspector:      z.array(ByInspectorSchema).describe('Per-inspector counts, pay, attributed revenue and median turnaround.'),
    serviceBreakdown: z.array(ServiceDistributionSchema).describe('Service mix by volume and revenue; empty without the financial capability.'),
    paymentSummary: z.object({
        paid:    z.number().describe('Effective revenue on inspections marked paid, in cents.'),
        unpaid:  z.number().describe('Effective revenue on inspections still unpaid, in cents.'),
        overdue: z.number().describe('Effective revenue past due, in cents.'),
    }).nullable().describe('Paid/unpaid split; null without the financial capability.'),
});

export const MetricsApiResponseSchema = createApiResponseSchema(MetricsResponseSchema);
