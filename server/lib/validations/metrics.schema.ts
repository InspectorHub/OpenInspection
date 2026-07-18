import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

export const MetricsQuerySchema = z.object({
    period: z.enum(['3m', '6m', '12m']).default('12m').describe('TODO describe period field for the OpenInspection MCP integration'),
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

const ServiceDistributionSchema = z.object({
    serviceName: z.string().describe('TODO describe serviceName field for the OpenInspection MCP integration'),
    count:       z.number().describe('TODO describe count field for the OpenInspection MCP integration'),
    revenue:     z.number().describe('TODO describe revenue field for the OpenInspection MCP integration'),
});

const MetricsResponseSchema = z.object({
    period:           z.string().describe('TODO describe period field for the OpenInspection MCP integration'),
    totalRevenue:     z.number().describe('TODO describe totalRevenue field for the OpenInspection MCP integration'),
    totalInspections: z.number().describe('TODO describe totalInspections field for the OpenInspection MCP integration'),
    avgOrderValue:    z.number().describe('TODO describe avgOrderValue field for the OpenInspection MCP integration'),
    monthly:          z.array(MonthlyDataSchema).describe('TODO describe monthly field for the OpenInspection MCP integration'),
    topAgents:        z.array(TopAgentSchema).describe('TODO describe topAgents field for the OpenInspection MCP integration'),
    serviceBreakdown: z.array(ServiceDistributionSchema).describe('TODO describe serviceBreakdown field for the OpenInspection MCP integration'),
    paymentSummary: z.object({
        paid:    z.number().describe('TODO describe paid field for the OpenInspection MCP integration'),
        unpaid:  z.number().describe('TODO describe unpaid field for the OpenInspection MCP integration'),
        overdue: z.number().describe('TODO describe overdue field for the OpenInspection MCP integration'),
    }).describe('TODO describe paymentSummary field for the OpenInspection MCP integration'),
});

export const MetricsApiResponseSchema = createApiResponseSchema(MetricsResponseSchema);
