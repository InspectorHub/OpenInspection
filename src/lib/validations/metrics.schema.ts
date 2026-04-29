import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

export const MetricsQuerySchema = z.object({
    period: z.enum(['3m', '6m', '12m']).default('12m'),
});

export const MonthlyDataSchema = z.object({
    month:   z.string(),
    revenue: z.number(),
    count:   z.number(),
});

export const TopAgentSchema = z.object({
    agentId:   z.string().nullable(),
    agentName: z.string(),
    count:     z.number(),
    revenue:   z.number(),
});

export const ServiceDistributionSchema = z.object({
    serviceName: z.string(),
    count:       z.number(),
    revenue:     z.number(),
});

export const MetricsResponseSchema = z.object({
    period:           z.string(),
    totalRevenue:     z.number(),
    totalInspections: z.number(),
    avgOrderValue:    z.number(),
    monthly:          z.array(MonthlyDataSchema),
    topAgents:        z.array(TopAgentSchema),
    serviceBreakdown: z.array(ServiceDistributionSchema),
    paymentSummary: z.object({
        paid:    z.number(),
        unpaid:  z.number(),
        overdue: z.number(),
    }),
});

export const MetricsApiResponseSchema = createApiResponseSchema(MetricsResponseSchema);
