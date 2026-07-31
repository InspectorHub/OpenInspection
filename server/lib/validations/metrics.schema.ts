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
    agentId:   z.string().nullable().describe('TODO describe agentId field for the OpenInspection MCP integration'),
    agentName: z.string().describe('TODO describe agentName field for the OpenInspection MCP integration'),
    count:     z.number().describe('TODO describe count field for the OpenInspection MCP integration'),
    revenue:   z.number().describe('TODO describe revenue field for the OpenInspection MCP integration'),
});

const ByInspectorSchema = z.object({
    inspectorId:       z.string().nullable().describe('User id of the lead (or fallback) inspector for this row.'),
    inspectorName:     z.string().describe('Display name of the inspector, falling back to id then Unknown.'),
    count:             z.number().describe('Number of inspections attributed to this inspector in the period.'),
    revenue:           z.number().describe('Summed inspection price attributed to this inspector.'),
    avgTurnaroundDays: z.number().nullable().describe('Average days from inspection date to first publish; null when none published.'),
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
    totalRevenue:     z.number().describe('TODO describe totalRevenue field for the OpenInspection MCP integration'),
    totalInspections: z.number().describe('TODO describe totalInspections field for the OpenInspection MCP integration'),
    avgOrderValue:    z.number().describe('TODO describe avgOrderValue field for the OpenInspection MCP integration'),
    monthly:          z.array(MonthlyDataSchema).describe('TODO describe monthly field for the OpenInspection MCP integration'),
    topAgents:        z.array(TopAgentSchema).describe('TODO describe topAgents field for the OpenInspection MCP integration'),
    byInspector:      z.array(ByInspectorSchema).describe('Per-inspector productivity: count, revenue, and average turnaround days.'),
    serviceBreakdown: z.array(ServiceDistributionSchema).describe('TODO describe serviceBreakdown field for the OpenInspection MCP integration'),
    paymentSummary: z.object({
        paid:    z.number().describe('TODO describe paid field for the OpenInspection MCP integration'),
        unpaid:  z.number().describe('TODO describe unpaid field for the OpenInspection MCP integration'),
        overdue: z.number().describe('TODO describe overdue field for the OpenInspection MCP integration'),
    }).describe('TODO describe paymentSummary field for the OpenInspection MCP integration'),
});

export const MetricsApiResponseSchema = createApiResponseSchema(MetricsResponseSchema);
