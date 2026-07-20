import { z } from 'zod';

export const CreateRoleProfileSchema = z.object({
    label: z.string().trim().min(1).max(80).describe('Tenant-editable display label for the new role profile, e.g. "Property Manager".'),
    kind: z.enum(['client', 'agent', 'other']).describe('Capability class the role derives from: client, agent, or other.'),
    emailTemplateId: z.string().optional().describe('Optional message-template id used for email notices to this role.'),
    smsTemplateId: z.string().optional().describe('Optional message-template id used for SMS notices to this role.'),
}).strict();

// kind + key are immutable after creation; not accepted here.
export const UpdateRoleProfileSchema = z.object({
    label: z.string().trim().min(1).max(80).optional().describe('Updated display label for the role profile.'),
    emailTemplateId: z.string().nullable().optional().describe('Updated message-template id for email notices, or null to clear it.'),
    smsTemplateId: z.string().nullable().optional().describe('Updated message-template id for SMS notices, or null to clear it.'),
    active: z.boolean().optional().describe('Set to false to deactivate the profile (rejected with 409 for isSystem profiles).'),
}).strip();

export const AddPersonSchema = z.object({
    contactId: z.string().min(1).describe('Id of the tenant-owned contact to assign to the inspection.'),
    roleProfileId: z.string().min(1).describe('Id of the tenant-owned role profile this contact will occupy on the inspection.'),
}).strict();

// Response shape for GET/POST /api/role-profiles rows. `tenantId` is included
// for parity with sibling entity schemas (e.g. ContractorTypeSchema); it never
// reflects anything other than the caller's own JWT-scoped tenant.
export const RoleProfileSchema = z.object({
    id: z.string().describe('Role profile id.'),
    tenantId: z.string().describe('Owning tenant.'),
    key: z.string().describe('Stable machine-readable key, unique per tenant.'),
    label: z.string().describe('Tenant-editable display label, e.g. "Buyer\'s Agent".'),
    kind: z.enum(['client', 'agent', 'other']).describe('Capability class the role derives from (client, agent, or other).'),
    emailTemplateId: z.string().nullable().describe('Optional message-template id used for email notices to this role.'),
    smsTemplateId: z.string().nullable().describe('Optional message-template id used for SMS notices to this role.'),
    isSystem: z.boolean().describe('True for built-in profiles that cannot be deactivated or deleted.'),
    sortOrder: z.number().int().describe('Display order.'),
    active: z.boolean().describe('False once the profile has been soft-deleted (deactivated).'),
    createdAt: z.union([z.string(), z.date(), z.number()]).describe('Creation time.'),
    updatedAt: z.union([z.string(), z.date(), z.number()]).describe('Last update time.'),
});
