import { z } from 'zod';

export const CreateRoleProfileSchema = z.object({
    label: z.string().trim().min(1).max(80),
    kind: z.enum(['client', 'agent', 'other']),
    emailTemplateId: z.string().optional(),
    smsTemplateId: z.string().optional(),
}).strict();

// kind + key are immutable after creation; not accepted here.
export const UpdateRoleProfileSchema = z.object({
    label: z.string().trim().min(1).max(80).optional(),
    emailTemplateId: z.string().nullable().optional(),
    smsTemplateId: z.string().nullable().optional(),
    active: z.boolean().optional(),
}).strip();

export const AddPersonSchema = z.object({
    contactId: z.string().min(1),
    roleProfileId: z.string().min(1),
}).strict();
