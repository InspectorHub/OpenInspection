import { z } from '@hono/zod-openapi';

// Inspector credential (Spec B) — self-asserted; no expiry field by design (§5).
export const CreateCredentialSchema = z.object({
  label: z.string().max(120).default('').describe('Human-readable credential label shown on reports, e.g. "InterNACHI Certified Professional Inspector".'),
  memberNumber: z.string().max(60).nullable().optional().describe('Optional membership or license number displayed alongside the credential label.'),
  sortOrder: z.number().int().optional().describe('Display order for this credential within the inspector list (ascending).'),
});
export const UpdateCredentialSchema = CreateCredentialSchema.partial();
export const CredentialSchema = z.object({
  id: z.string(),
  label: z.string(),
  memberNumber: z.string().nullable(),
  imageUrl: z.string().nullable(),
  sortOrder: z.number(),
  active: z.boolean(),
});
