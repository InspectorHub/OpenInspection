import { z } from '@hono/zod-openapi';

/**
 * Commercial PCA Phase S — partial-patch body for PATCH
 * /api/inspections/:id/pca-narrative. Every key is an optional string; omitted
 * keys are left unchanged. Unknown (old-shape) keys are stripped (default Zod
 * object behavior) so the pre-launch reset is tolerant.
 */
export const PcaNarrativePatchSchema = z.object({
  transmittalLetter: z.string().optional(),
  summaryGeneralDescription: z.string().optional(),
  summaryPhysicalCondition: z.string().optional(),
  summaryRecommendations: z.string().optional(),
  purpose: z.string().optional(),
  scopeOfWork: z.string().optional(),
  limitationsExceptions: z.string().optional(),
  reconnaissance: z.string().optional(),
  additionalConsiderations: z.string().optional(),
});

export type PcaNarrativePatch = z.infer<typeof PcaNarrativePatchSchema>;
