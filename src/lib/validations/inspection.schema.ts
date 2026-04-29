import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Core Inspection Schema (Output)
 */
export const InspectionSchema = z.object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    propertyAddress: z.string().openapi({ example: '123 Main St, Anytown' }),
    clientName: z.string().nullable().openapi({ example: 'John Doe' }),
    clientEmail: z.string().email().nullable().openapi({ example: 'john@example.com' }),
    status: z.enum(['draft', 'completed', 'delivered']).openapi({ example: 'draft' }),
    date: z.string().openapi({ example: '2024-03-20' }),
    inspectorId: z.string().uuid().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }),
    templateId: z.string().uuid().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440002' }),
    createdAt: z.string().datetime().openapi({ example: '2024-03-20T10:00:00Z' }),
}).openapi('Inspection');

/**
 * Validation schema for list filtering and pagination.
 */
export const InspectionListQuerySchema = z.object({
    limit: z.coerce.number().min(1).max(100).default(20).openapi({ example: 20 }),
    cursor: z.string().optional().openapi({ example: 'eyJpZCI6IjU1MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMCJ9' }),
    status: z.enum(['draft', 'completed', 'delivered']).optional().openapi({ example: 'completed' }),
    search: z.string().optional().openapi({ example: '123 Main' }),
    inspectorId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().openapi({ example: '2024-01-01' }),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().openapi({ example: '2024-12-31' }),
    tab: z.enum(['all', 'today', 'upcoming', 'past', 'unconfirmed', 'in_progress']).optional().openapi({ example: 'today' }),
}).openapi('InspectionListQuery');

/**
 * Validation schema for creating a new inspection.
 */
export const CreateInspectionSchema = z.object({
    propertyAddress: z.string().min(5, 'Property address is too short').openapi({ example: '123 Main St, Anytown' }),
    clientName: z.string().min(1, 'Client name is required').default('Private Client').openapi({ example: 'John Doe' }),
    clientEmail: z.string().email('Invalid email address').optional().nullable().openapi({ example: 'john@example.com' }),
    clientPhone: z.string().max(30).optional().nullable().openapi({ example: '(555) 123-4567' }),
    templateId: z.string().uuid('Invalid template ID').openapi({ example: '550e8400-e29b-41d4-a716-446655440002' }),
    inspectorId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }),
    date: z.string().datetime().optional().openapi({ example: '2024-03-20T10:00:00Z' }),
    referredByAgentId: z.string().uuid().optional().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440003' }),
    serviceIds:     z.array(z.string()).optional(),
    discountCodeId: z.string().nullable().optional(),
    discountAmount: z.number().int().nullable().optional(),
    price:          z.number().int().min(0).optional(),
}).openapi('CreateInspection');

/**
 * Validation schema for patching inspection metadata.
 */
export const UpdateInspectionSchema = z.object({
    propertyAddress: z.string().min(5).optional().openapi({ example: '123 Main St, Anytown' }),
    clientName: z.string().min(1).optional().openapi({ example: 'John Doe' }),
    clientEmail: z.string().email().optional().nullable().openapi({ example: 'john@example.com' }),
    date: z.string().datetime().optional().openapi({ example: '2024-03-20T10:00:00Z' }),
    inspectorId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440001' }),
    price: z.number().min(0).optional().openapi({ example: 450 }),
    status: z.enum(['draft', 'completed', 'delivered']).optional().openapi({ example: 'completed' }),
    paymentRequired:   z.boolean().optional().openapi({ example: false }),
    agreementRequired: z.boolean().optional().openapi({ example: false }),
    yearBuilt:      z.number().int().min(1800).max(2100).nullable().optional().openapi({ example: 1990 }),
    sqft:           z.number().int().min(0).nullable().optional().openapi({ example: 1800 }),
    foundationType: z.enum(['basement', 'slab', 'crawlspace', 'other']).nullable().optional(),
    bedrooms:       z.number().int().min(0).nullable().optional().openapi({ example: 3 }),
    bathrooms:      z.number().min(0).max(20).nullable().optional().openapi({ example: 2.5 }),
    unit:           z.string().max(50).nullable().optional(),
    county:         z.string().max(100).nullable().optional(),
}).openapi('UpdateInspection');

export const CancelInspectionSchema = z.object({
    reason: z.enum(['client_cancelled', 'scheduling_conflict', 'weather', 'other']),
    notes:  z.string().max(500).optional(),
}).openapi('CancelInspection');

export const InspectionCountsSchema = z.object({
    all:         z.number().openapi({ example: 42 }),
    today:       z.number().openapi({ example: 3 }),
    upcoming:    z.number().openapi({ example: 12 }),
    past:        z.number().openapi({ example: 27 }),
    unconfirmed: z.number().openapi({ example: 2 }),
    inProgress:  z.number().openapi({ example: 1 }),
}).openapi('InspectionCounts');
export type InspectionCounts = z.infer<typeof InspectionCountsSchema>;

/**
 * Stats Schema
 */
export const InspectionStatsSchema = z.object({
    total: z.number().openapi({ example: 100 }),
    draft: z.number().openapi({ example: 20 }),
    completed: z.number().openapi({ example: 50 }),
    delivered: z.number().openapi({ example: 30 }),
}).openapi('InspectionStats');

/**
 * Validation schema for inspection results patch.
 */
export const PatchResultsSchema = z.object({
    data: z.record(z.string(), z.unknown()),
}).openapi('PatchResults');

/**
 * Validation schema for bulk operations.
 */
export const BulkInspectionSchema = z.object({
    ids: z.array(z.string().uuid()).min(1).max(100),
    action: z.enum(['assignInspector', 'updateStatus']),
    inspectorId: z.string().uuid().optional(),
    status: z.enum(['draft', 'completed', 'delivered']).optional(),
}).openapi('BulkInspection');

/**
 * Response Schemas
 */
export const InspectionResponseSchema = createApiResponseSchema(InspectionSchema).openapi('InspectionResponse');
export const InspectionListResponseSchema = createApiResponseSchema(z.array(InspectionSchema)).openapi('InspectionListResponse');
export const InspectionStatsResponseSchema = createApiResponseSchema(InspectionStatsSchema).openapi('InspectionStatsResponse');

// --- Report Data ---

export const PublishInspectionSchema = z.object({
  theme: z.enum(['modern', 'classic', 'minimal']).default('modern'),
  notifyClient: z.boolean().default(true),
  notifyAgent: z.boolean().default(true),
  requireSignature: z.boolean().default(false),
  requirePayment: z.boolean().default(false),
}).openapi('PublishInspection');

export const ReportItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  rating: z.string().nullable(),
  ratingColor: z.string(),
  ratingLabel: z.string().nullable(),
  severityBucket: z.enum(['satisfactory', 'monitor', 'defect', 'other']),
  notes: z.string().nullable(),
  photos: z.array(z.object({ key: z.string(), url: z.string() })),
  recommendation: z.string().nullable().optional(),
  estimateMin: z.number().nullable().optional(),
  estimateMax: z.number().nullable().optional(),
}).openapi('ReportItem');

export const ReportSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string().nullable().optional(),
  defectCount: z.number(),
  items: z.array(ReportItemSchema),
}).openapi('ReportSection');

export const ReportDataResponseSchema = z.object({
  inspection: z.object({
    id: z.string(),
    propertyAddress: z.string(),
    date: z.string(),
    status: z.string(),
    inspectorName: z.string().nullable(),
  }),
  theme: z.enum(['modern', 'classic', 'minimal']),
  stats: z.object({
    total: z.number(),
    satisfactory: z.number(),
    monitor: z.number(),
    defect: z.number(),
  }),
  sections: z.array(ReportSectionSchema),
  ratingLevels: z.array(z.object({
    id: z.string(),
    label: z.string(),
    abbreviation: z.string(),
    color: z.string(),
    severity: z.string(),
    isDefect: z.boolean(),
  })),
}).openapi('ReportData');
