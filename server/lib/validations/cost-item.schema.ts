/**
 * Commercial PCA Phase C Task 13a — Zod validation for cost_items CRUD.
 * Mirrors the render-facing `CostItem` shape (server/lib/pca-costs.ts) plus
 * the scope soft-references + inspection linkage columns on the `cost_items`
 * table (server/lib/db/schema/inspection/cost-items.ts). Money + reserve
 * fields are integer cents / integer years — never accept fractional or
 * negative values. `z` is imported from `@hono/zod-openapi` (not plain
 * `zod`) so these schemas plug directly into `createRoute({ request: {
 * body: ... } })` for the CRUD routes (server/api/inspections/cost-items.ts),
 * matching every other schema under server/lib/validations/.
 */
import { z } from '@hono/zod-openapi';

// Shared builders (route-metadata gate requires a per-FIELD .describe(), so
// every call site below chains its own .describe() on top of these — never
// rely on a description set upstream on the shared builder).
const cents = () => z.number().int().nonnegative().nullable().optional();
const years = () => z.number().int().nonnegative().nullable().optional();

export const CreateCostItemSchema = z.object({
  buildingId: z.string().nullable().optional().describe('Phase F building/instance scope soft-ref.'),
  instanceIndex: z.number().int().nonnegative().nullable().optional().describe('Phase F instance index within the building.'),
  unitId: z.string().nullable().optional().describe('Phase U per-unit scope soft-ref; null = common/tagged scope.'),
  findingKey: z.string().nullable().optional().describe('Originating finding key (unitId:sectionId:itemId), if linked.'),
  system: z.string().min(1).describe('ASTM system grouping, e.g. "roof".'),
  component: z.string().min(1).describe('Component within the system, e.g. "membrane".'),
  location: z.string().optional().describe('Tagged-mode scope location label.'),
  action: z.enum(['repair', 'replace', 'further_study']).describe('Remedial action for this line item.'),
  costMethod: z.enum(['unit', 'lump_sum']).describe('Whether the cost is quantity x unit cost or a flat lump sum.'),
  quantity: z.number().int().nonnegative().nullable().optional().describe('Unit-method quantity (null for lump_sum).'),
  uom: z.string().nullable().optional().describe('Unit of measure for the quantity, e.g. "sf".'),
  unitCostCents: cents().describe('Per-unit cost in integer cents (unit method only).'),
  lumpSumCents: cents().describe('Flat total cost in integer cents (lump_sum method only).'),
  eul: years().describe('Expected Useful Life in years, for the reserve schedule.'),
  effAge: years().describe('Effective Age in years, for the reserve schedule.'),
  rul: years().describe('Remaining Useful Life in years, for the reserve schedule.'),
  suggestedRemedy: z.string().optional().describe('Free-text remedy description shown on the report line.'),
  bucket: z.enum(['immediate', 'short_term', 'long_term']).describe('Deferred maintenance vs. capital reserve bucket.'),
  sectionRef: z.string().nullable().optional().describe('Report section anchor this line item cross-references.'),
  photoRef: z.string().nullable().optional().describe('Photo key this line item cross-references.'),
  sortOrder: z.number().int().optional().describe('Display order within the bucket.'),
});

export const UpdateCostItemSchema = CreateCostItemSchema.partial();
