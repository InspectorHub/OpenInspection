import { z } from '@hono/zod-openapi';

/**
 * Commercial PCA Phase S — partial-patch body for PATCH
 * /api/inspections/:id/pca-narrative. Every key is an optional string; omitted
 * keys are left unchanged. Unknown (old-shape) keys are stripped (default Zod
 * object behavior) so the pre-launch reset is tolerant.
 */
export const PcaNarrativePatchSchema = z.object({
  transmittalLetter: z.string().optional().describe('Transmittal Letter narrative block'),
  summaryGeneralDescription: z.string().optional().describe('Executive Summary 1.1 General Description block'),
  summaryPhysicalCondition: z.string().optional().describe('Executive Summary 1.2 General Physical Condition block'),
  summaryRecommendations: z.string().optional().describe('Executive Summary 1.5 Recommendations block'),
  purpose: z.string().optional().describe('Introduction 2.1 Purpose narrative block'),
  scopeOfWork: z.string().optional().describe('Introduction 2.2 Scope of Work block (methodology folds in)'),
  limitationsExceptions: z.string().optional().describe('Introduction 2.3 Limitations and Exceptions block'),
  reconnaissance: z.string().optional().describe('Introduction 2.4 General Property Reconnaissance block'),
  additionalConsiderations: z.string().optional().describe('Additional Considerations narrative block'),
});

export type PcaNarrativePatch = z.infer<typeof PcaNarrativePatchSchema>;
