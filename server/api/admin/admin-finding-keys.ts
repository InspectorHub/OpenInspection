// Admin → the one-time legacy finding-key migration.
//
// Split out of `admin-data-import.ts` when that file crossed the 400-line gate.
// The seam is not arbitrary: everything here is a ONE-TIME data migration over
// `inspection_results`, sharing nothing with the import-intake surface next
// door but the word "data" and an `/api/admin` prefix. That file is now about
// one thing — what can happen to an import run somebody sent us to convert —
// and this one is about a rewrite that will eventually be deleted outright.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { auditFromContext } from '../../lib/audit';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from "../../lib/route-metadata-standards";
import { FindingKeyMigrationResultSchema } from '../../lib/validations/admin/finding-keys';
import { migrateFindingKeys, renameThroughDurableObject } from '../../lib/inspection/finding-key-migration';
import { getDrizzle } from '../../lib/route-helpers';

// --- Finding Key Migration (one-time data migration) ---
//
// Batch-converts inspection_results.data keys from the legacy `itemId`
// format to the composite `_default:sectionId:itemId` format. Idempotent —
// keys that already contain 2+ colons are skipped, and underscore-prefixed
// meta keys are never touched. A results row that has collab state is not
// rewritten here: its Durable Object renames the keys in the live document.
// The work lives in `lib/inspection/finding-key-migration.ts`.

const migrateFindingKeysRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/migrate-finding-keys',
    tags: ['admin'],
    summary: 'One-time migration: rewrite legacy finding keys to composite format',
    middleware: [requireRole('owner')] as const,
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: FindingKeyMigrationResultSchema,
                    }),
                },
            },
            description: 'Migration complete',
        },
    },
    operationId: 'migrateFindingKeys',
    description: 'Batch-converts inspection_results.data keys from legacy itemId format to composite _default:sectionId:itemId format. Idempotent — already-composite keys are skipped and underscore-prefixed meta keys are never rewritten. Rows with live collaborative state are always renamed inside their document, as are rows without state when the tenant has collaboration on; those count as delegated, with renamedInDocuments and conflicts summed from the documents. A failure for one inspection is listed in failedIds and does not stop the rest. Every results row examined counts in exactly one of migrated, delegated, failed or skipped.',
}, { scopes: ['admin'], tier: 'extended' }));


const app = createApiRouter();
app.openapi(migrateFindingKeysRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const result = await migrateFindingKeys(
        getDrizzle(c),
        tenantId,
        renameThroughDurableObject(c.env.INSPECTION_DOC, tenantId),
    );

    auditFromContext(c, 'admin.migrate_finding_keys', 'inspection_results', {
        metadata: {
            processed: result.processed,
            migrated:  result.migrated,
            skipped:   result.skipped,
            delegated: result.delegated,
            failed:    result.failed,
            renamed:   result.renamedInDocuments,
            conflicts: result.conflicts,
        },
    });

    return c.json({ success: true as const, data: result }, 200);
});

/** Registration order. Drives the typed client; a test pins it to what `app` really registered. */
export const adminFindingKeyRouteConfigs = [
    migrateFindingKeysRoute,
] as const;

export default app;
