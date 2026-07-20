import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { Errors } from '../lib/errors';
import { auditFromContext } from '../lib/audit';
import {
  CreateCredentialSchema,
  UpdateCredentialSchema,
  CredentialSchema,
} from '../lib/validations/credential.schema';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import type { InspectorCredential } from '../services/credential.service';

// Serialize a stored row to the wire shape: the private R2 key becomes a public
// brand-asset URL; never leak the raw key.
function toDto(row: InspectorCredential) {
  return {
    id: row.id,
    label: row.label,
    memberNumber: row.memberNumber ?? null,
    imageUrl: row.imageR2Key ? `/api/public/brand-asset?key=${encodeURIComponent(row.imageR2Key)}` : null,
    sortOrder: row.sortOrder,
    active: !!row.active,
  };
}

const CredentialResponseSchema = z.object({ success: z.literal(true), data: CredentialSchema });
const CredentialListResponseSchema = z.object({ success: z.literal(true), data: z.array(CredentialSchema) });

const OWN = requireRole('inspector', 'owner', 'manager');

const listRoute = createRoute(withMcpMetadata({
  method: 'get', path: '/',
  tags: ['credentials'],
  summary: "List the signed-in inspector's credentials",
  middleware: [OWN] as const,
  request: {},
  responses: { 200: { content: { 'application/json': { schema: CredentialListResponseSchema } }, description: 'List' } },
  operationId: 'listInspectorCredentials',
  description: 'Lists the signed-in inspector self-asserted credentials (label, member number, badge image).',
}, { scopes: ['read'], tier: 'primary' }));

const createRouteDef = createRoute(withMcpMetadata({
  method: 'post', path: '/',
  tags: ['credentials'],
  summary: 'Add a credential for the signed-in inspector',
  middleware: [OWN] as const,
  request: { body: { content: { 'application/json': { schema: CreateCredentialSchema } } } },
  responses: { 200: { content: { 'application/json': { schema: CredentialResponseSchema } }, description: 'Created' } },
  operationId: 'createInspectorCredential',
  description: 'Adds a credential row for the signed-in inspector (image uploaded separately).',
}, { scopes: ['write'], tier: 'primary' }));

const updateRouteDef = createRoute(withMcpMetadata({
  method: 'patch', path: '/{id}',
  tags: ['credentials'],
  summary: 'Update an inspector credential label or number',
  middleware: [OWN] as const,
  request: {
    params: z.object({ id: z.string().min(1).describe('The credential id to update; scoped to the signed-in inspector.') }),
    body: { content: { 'application/json': { schema: UpdateCredentialSchema } } },
  },
  responses: { 200: { content: { 'application/json': { schema: CredentialResponseSchema } }, description: 'Updated' } },
  operationId: 'updateInspectorCredential',
  description: "Updates a credential's label / member number / sort order.",
}, { scopes: ['write'], tier: 'primary' }));

const deleteRouteDef = createRoute(withMcpMetadata({
  method: 'delete', path: '/{id}',
  tags: ['credentials'],
  summary: 'Delete an inspector credential and its image',
  middleware: [OWN] as const,
  request: { params: z.object({ id: z.string().min(1).describe('The credential id to delete; scoped to the signed-in inspector.') }) },
  responses: { 200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ deleted: z.literal(true) }) }) } }, description: 'Deleted' } },
  operationId: 'deleteInspectorCredential',
  description: 'Deletes a credential and purges its uploaded image.',
}, { scopes: ['write'], tier: 'primary' }));

const uploadRouteDef = createRoute(withMcpMetadata({
  method: 'post', path: '/{id}/image',
  tags: ['credentials'],
  summary: 'Upload/replace a credential badge image',
  middleware: [OWN] as const,
  request: {
    params: z.object({ id: z.string().min(1).describe('The credential id whose badge image is being uploaded or replaced.') }),
    body: { content: { 'multipart/form-data': { schema: z.object({ image: z.any().openapi({ type: 'string', format: 'binary' }).describe('The badge image file (png, svg, jpeg, or webp; up to 2MB).') }) } } },
  },
  responses: { 200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ imageUrl: z.string() }) }) } }, description: 'Uploaded' } },
  operationId: 'uploadInspectorCredentialImage',
  description: 'Uploads (or replaces) the badge image for a credential; returns the public asset URL.',
}, { scopes: ['write'], tier: 'extended' }));

const MAX_BADGE_BYTES = 2_000_000;
const ALLOWED = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'];

const credentialsRoutes = createApiRouter()
  .openapi(listRoute, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const userId = c.get('user').sub;
    const rows = await c.var.services.credentials.listByUser(tenantId, userId);
    return c.json({ success: true as const, data: rows.map(toDto) }, 200);
  })
  .openapi(createRouteDef, async (c) => {
    const input = c.req.valid('json');
    const tenantId = c.get('tenantId') as string;
    const userId = c.get('user').sub;
    const row = await c.var.services.credentials.create(tenantId, userId, input);
    auditFromContext(c, 'credential.created', 'credential', { entityId: row.id });
    return c.json({ success: true as const, data: toDto(row) }, 200);
  })
  .openapi(updateRouteDef, async (c) => {
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json');
    const tenantId = c.get('tenantId') as string;
    const userId = c.get('user').sub;
    const row = await c.var.services.credentials.update(id, tenantId, userId, patch);
    auditFromContext(c, 'credential.updated', 'credential', { entityId: id });
    return c.json({ success: true as const, data: toDto(row) }, 200);
  })
  .openapi(deleteRouteDef, async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId') as string;
    const userId = c.get('user').sub;
    await c.var.services.credentials.delete(id, tenantId, userId);
    auditFromContext(c, 'credential.deleted', 'credential', { entityId: id });
    return c.json({ success: true as const, data: { deleted: true as const } }, 200);
  })
  .openapi(uploadRouteDef, async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId') as string;
    const userId = c.get('user').sub;
    const formData = await c.req.formData();
    const file = formData.get('image');
    if (!file || !(file instanceof File)) throw Errors.BadRequest('No image file provided.');
    if (file.size > MAX_BADGE_BYTES) throw Errors.BadRequest('image > 2MB');
    if (!ALLOWED.includes(file.type)) throw Errors.BadRequest('image must be png, svg, jpeg, or webp');
    const imageUrl = await c.var.services.credentials.uploadImage(tenantId, userId, id, file);
    auditFromContext(c, 'credential.image_uploaded', 'credential', { entityId: id });
    return c.json({ success: true as const, data: { imageUrl } }, 200);
  });

export type CredentialsApi = typeof credentialsRoutes;

export default credentialsRoutes;
