import { z } from '@hono/zod-openapi';

// Inspector credential (Spec B) — self-asserted; no expiry field by design (§5).
export const CreateCredentialSchema = z.object({
  label: z.string().max(120).default(''),
  memberNumber: z.string().max(60).nullable().optional(),
  sortOrder: z.number().int().optional(),
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
export type CreateCredentialInput = z.infer<typeof CreateCredentialSchema>;
export type UpdateCredentialInput = z.infer<typeof UpdateCredentialSchema>;
