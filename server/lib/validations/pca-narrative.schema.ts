import { z } from '@hono/zod-openapi';

/**
 * Commercial PCA Phase S — partial-patch body for PATCH
 * /api/inspections/:id/pca-narrative. Every key is an optional string; omitted
 * keys are left unchanged. An unknown key answers 400 naming it, so a
 * write is never dropped behind a 200.
 *
 * The three reliance text keys (userReliance/pointInTime/siteSpecific, ASTM
 * §4.2.1–4.2.4) are patchable here alongside the free-prose narrative blocks:
 * they share the same pca_narrative JSON column.
 */
const PcaNarrativeBlocksSchema = z.object({
  transmittalLetter: z.string().optional().describe('Transmittal Letter narrative block'),
  summaryGeneralDescription: z.string().optional().describe('Executive Summary 1.1 General Description block'),
  summaryPhysicalCondition: z.string().optional().describe('Executive Summary 1.2 General Physical Condition block'),
  summaryRecommendations: z.string().optional().describe('Executive Summary 1.5 Recommendations block'),
  purpose: z.string().optional().describe('Introduction 2.1 Purpose narrative block'),
  scopeOfWork: z.string().optional().describe('Introduction 2.2 Scope of Work block (methodology folds in)'),
  limitationsExceptions: z.string().optional().describe('Introduction 2.3 Limitations and Exceptions block'),
  reconnaissance: z.string().optional().describe('Introduction 2.4 General Property Reconnaissance block'),
  additionalConsiderations: z.string().optional().describe('Additional Considerations narrative block'),
  userReliance: z.string().optional().describe('Reliance §4.2.1 — parties entitled to rely on the report'),
  pointInTime: z.string().optional().describe('Reliance §4.2.3 — point-in-time assessment limitation'),
  siteSpecific: z.string().optional().describe('Reliance §4.2.4 — site-specific scope limitation'),
});

/**
 * The published request schema is the plain object above. The refusal of an unknown key is a
 * runtime check ahead of it (the object schema would strip the key before any refinement saw it),
 * so the contract does not tighten while a misspelled key still answers 400 and names itself.
 */
export const PcaNarrativePatchSchema = z.preprocess((raw, ctx) => {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const unknown = Object.keys(raw).filter((key) => !Object.hasOwn(PcaNarrativeBlocksSchema.shape, key));
    if (unknown.length > 0) ctx.addIssue({ code: 'custom', message: `Unknown narrative key(s): ${unknown.join(', ')}` });
  }
  return raw;
}, PcaNarrativeBlocksSchema);
