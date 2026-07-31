import { z } from 'zod';

// Field-for-field mirror of RoleCapabilities (server/lib/people/capabilities.ts).
// All fields optional: overrides layer on the kind baseline, so a partial
// object is meaningful — though the settings UI always submits the full set.
const CapabilityOverridesSchema = z.object({
    receivesReport: z.boolean().optional().describe('Whether this role receives the report.'),
    selfRetrieveReport: z.boolean().optional().describe('Whether this role may fetch the report itself.'),
    canHaveAccount: z.boolean().optional().describe('Whether this role may hold a portal account.'),
    showsInAgentPortal: z.boolean().optional().describe("Whether the inspection appears in this role's own agent portal list."),
    canAccessRepairList: z.enum(['off', 'read', 'readwrite']).optional().describe("Access to the buyer's repair list, resolved against the tenant policy by taking the stricter of the two."),
}).nullable().optional().describe('Per-profile overrides layered on the kind baseline.');

export const CreateRoleProfileSchema = z.object({
    label: z.string().trim().min(1).max(80).describe('Tenant-editable display label for the new role profile, e.g. "Property Manager".'),
    kind: z.enum(['client', 'agent', 'other']).describe('Capability class the role derives from: client, agent, or other.'),
    emailTemplateId: z.string().optional().describe('Optional message-template id used for email notices to this role.'),
    smsTemplateId: z.string().optional().describe('Optional message-template id used for SMS notices to this role.'),
    capabilityOverrides: CapabilityOverridesSchema,
}).strict();

// kind + key are immutable after creation; not accepted here.
export const UpdateRoleProfileSchema = z.object({
    label: z.string().trim().min(1).max(80).optional().describe('Updated display label for the role profile.'),
    emailTemplateId: z.string().nullable().optional().describe('Updated message-template id for email notices, or null to clear it.'),
    smsTemplateId: z.string().nullable().optional().describe('Updated message-template id for SMS notices, or null to clear it.'),
    active: z.boolean().optional().describe('Set to false to deactivate the profile (rejected with 409 for isSystem profiles).'),
    capabilityOverrides: CapabilityOverridesSchema,
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
    capabilityOverrides: z.unknown().nullable().optional().describe('Per-profile capability overrides layered on the kind baseline; resolve with capabilitiesForProfile.'),
    isSystem: z.boolean().describe('True for built-in profiles that cannot be deactivated or deleted.'),
    sortOrder: z.number().int().describe('Display order.'),
    active: z.boolean().describe('False once the profile has been soft-deleted (deactivated).'),
    createdAt: z.union([z.string(), z.date(), z.number()]).describe('Creation time.'),
    updatedAt: z.union([z.string(), z.date(), z.number()]).describe('Last update time.'),
});
