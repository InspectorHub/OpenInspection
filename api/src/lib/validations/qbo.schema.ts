import { z } from '@hono/zod-openapi';

export const QBOCloudEventSchema = z.object({
    specversion:     z.string().describe('TODO describe specversion field for the OpenInspection MCP integration'),
    id:              z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    source:          z.string().describe('TODO describe source field for the OpenInspection MCP integration'),
    type:            z.string().describe('TODO describe type field for the OpenInspection MCP integration'),
    datacontenttype: z.string().optional().describe('TODO describe datacontenttype field for the OpenInspection MCP integration'),
    time:            z.string().optional().describe('TODO describe time field for the OpenInspection MCP integration'),
    intuitentityid:  z.string().describe('TODO describe intuitentityid field for the OpenInspection MCP integration'),
    intuitaccountid: z.string().describe('TODO describe intuitaccountid field for the OpenInspection MCP integration'),
    data:            z.record(z.string(), z.unknown()).optional().describe('TODO describe data field for the OpenInspection MCP integration'),
});

export const QBOCompanyInfoResponseSchema = z.object({
    CompanyInfo: z.object({
        CompanyName: z.string().describe('TODO describe CompanyName field for the OpenInspection MCP integration'),
    }).describe('TODO describe CompanyInfo field for the OpenInspection MCP integration'),
});

export const QBOTokenResponseSchema = z.object({
    access_token:               z.string().describe('TODO describe access_token field for the OpenInspection MCP integration'),
    refresh_token:              z.string().describe('TODO describe refresh_token field for the OpenInspection MCP integration'),
    x_refresh_token_expires_in: z.number().describe('TODO describe x_refresh_token_expires_in field for the OpenInspection MCP integration'),
    token_type:                 z.string().optional().describe('TODO describe token_type field for the OpenInspection MCP integration'),
});

export const QBOLinkCustomerBodySchema = z.object({
    qboCustomerId: z.string().min(1).describe('TODO describe qboCustomerId field for the OpenInspection MCP integration'),
});

export type QBOCloudEvent = z.infer<typeof QBOCloudEventSchema>;
