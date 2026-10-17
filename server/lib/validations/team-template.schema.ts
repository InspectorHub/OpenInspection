import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';
import { capabilityToggleMap } from './admin/compliance';
import { MAX_TEMPLATE_NAME_LENGTH, TEMPLATE_ROLES } from '../auth/permission-templates';

/** Body of POST and PUT /api/team/permission-templates. */
export const PermissionTemplateInputSchema = z.object({
    name: z.string().trim().min(1).max(MAX_TEMPLATE_NAME_LENGTH)
        .openapi({ example: 'Weekend helper' })
        .describe('The template\'s name, unique among the company\'s live templates. Shown in the invite and edit forms.'),
    baseRole: z.enum(TEMPLATE_ROLES)
        .openapi({ example: 'inspector' })
        .describe('The role a person gets when the template is applied: manager, inspector or staff. Never owner or agent.'),
    overrides: capabilityToggleMap().optional()
        .openapi({ example: { publish: false } })
        .describe('Capability switches that differ from the base role\'s defaults. Switches the role fixes, and switches equal to the default, are dropped when saved.'),
}).openapi('PermissionTemplateInput');

/** One template in the list: a built-in (system) one or the company's own. */
export const PermissionTemplateSchema = z.object({
    id: z.string().describe('The key of a built-in template or the id of a company template. Pass it as templateId on an invite or a member update.'),
    system: z.boolean().describe('True for a built-in template, which cannot be changed or archived.'),
    name: z.string().describe('The template\'s name. For a built-in template this is the English name; the Team page shows a translated one.'),
    description: z.string().nullable().describe('A sentence on what the template is for. Null for a company template.'),
    baseRole: z.enum(TEMPLATE_ROLES).describe('The role a person gets when the template is applied.'),
    overrides: capabilityToggleMap().describe('Capability switches that differ from the base role\'s defaults, exactly as they are stamped onto an invite or a member.'),
}).openapi('PermissionTemplate');

export const PermissionTemplateListResponseSchema = createApiResponseSchema(z.object({
    templates: z.array(PermissionTemplateSchema).describe('Built-in templates first, then the company\'s own, oldest first.'),
    maxCompanyTemplates: z.number().int().describe('How many company templates one company may keep.'),
})).openapi('PermissionTemplateListResponse');

export const PermissionTemplateResponseSchema = createApiResponseSchema(PermissionTemplateSchema).openapi('PermissionTemplateResponse');
