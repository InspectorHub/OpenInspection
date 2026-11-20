/**
 * Refuses writes to an inspection restored from a data package (409
 * `IMPORTED_INSPECTION_READ_ONLY`). A restored inspection is an immutable copy:
 * the archive is byte-identical and its signed evidence verifies against the
 * original bytes, so changing the live row would break that correspondence.
 *
 * ONE path-scoped middleware rather than a per-route guard (a guard a new route
 * forgets to wear). The same shape as the report-authoring / report-lock guards.
 * Mounted AFTER those guards so an unauthorised caller still gets their 403
 * first, and BEFORE the routers.
 *
 * Reads (GET/HEAD/OPTIONS) are never affected. The allow list is explicit and
 * each entry carries a reason (see ALLOWED_WRITES) so a mutating route is either
 * guarded or deliberately exempted with a documented justification — the
 * conformance test fails when a new write route is neither.
 *
 * Two writers are not plain routes under `/api/inspections/:id/` and check the
 * same marker inside their own service layer: the offline package import and
 * the collaborative document socket (they cannot answer a 409).
 */
import type { Context, MiddlewareHandler } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { getDrizzle } from '../route-helpers';
import { Errors } from '../../lib/errors';
import { importIdMap } from '../../lib/db/schema/data-package';
import type { HonoConfig } from '../../types/hono';

const INSPECTION_PATH = /^\/api\/inspections\/([^/]+)\//;

/**
 * Mutating inspection paths that remain writable on a restored inspection, each
 * with the reason. These are the operations the product allows: copy into a NEW
 * inspection, and withdraw/restore publication of an EXISTING version. Creating
 * a new report version, editing results, re-inspection, new agreements/invoices
 * and similar writes are NOT here and stay refused.
 */
export const ALLOWED_WRITES: Record<string, string> = {
    'POST /api/inspections/:id/copy-report': 'copies into a NEW inspection, which is not imported',
    'POST /api/inspections/:id/publish': 'restore publication of an existing report version',
    'POST /api/inspections/:id/unpublish': 'withdraw publication of an existing report version',
};

function normalize(path: string): string {
    return path.replace(/^\/api\/inspections\/:(inspectionId|id)\//, '/api/inspections/:id/');
}

function toRegExp(key: string): RegExp {
    const pattern = normalize(key).split('/').map((seg) =>
        seg.startsWith(':') ? '[^/]+' : seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&'),
    ).join('/');
    return new RegExp(`^${pattern}$`);
}

const ALLOWED_MATCHERS = Object.entries(ALLOWED_WRITES).map(([key, reason]) => ({
    method: key.split(' ')[0]!,
    matcher: toRegExp(key.split(' ')[1]!),
    reason,
}));

/** Whether a mutating route is explicitly allowed on a restored inspection. */
export function isAllowedImportedWrite(method: string, path: string): boolean {
    const m = method.toUpperCase();
    const p = normalize(path);
    return ALLOWED_MATCHERS.some((e) => e.method === m && e.matcher.test(p));
}

/** Whether a path addresses an inspection under the guarded prefix. */
export function isInspectionWritePath(path: string): string | null {
    return INSPECTION_PATH.exec(path)?.[1] ?? null;
}

/** True iff the inspection id is a marker in import_id_map (restored copy). */
async function isImportedInspection(
    db: ReturnType<typeof getDrizzle>, tenantId: string, inspectionId: string,
): Promise<boolean> {
    const rows = await db.select({ id: importIdMap.id }).from(importIdMap).where(and(
        eq(importIdMap.tenantId, tenantId),
        eq(importIdMap.tableName, 'inspections'),
        eq(importIdMap.newId, inspectionId),
    )).limit(1).all();
    return rows.length > 0;
}

export const importedInspectionGuard: MiddlewareHandler<HonoConfig> = Object.assign(
    async (c: Context<HonoConfig>, next: () => Promise<void>) => {
        const method = c.req.method;
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
        const inspectionId = isInspectionWritePath(c.req.path);
        const tenantId = c.get('tenantId');
        if (!inspectionId || !tenantId) return next();
        if (isAllowedImportedWrite(method, c.req.path)) return next();
        if (await isImportedInspection(getDrizzle(c), tenantId, inspectionId)) {
            throw Errors.ImportedInspectionReadOnly(inspectionId);
        }
        return next();
    },
    { importedInspectionGuard: true as const },
);

/** Mount after the other inspection guards, before the routers. */
export function registerImportedInspectionGuard(app: OpenAPIHono<HonoConfig>): void {
    app.use('/api/inspections/*', importedInspectionGuard);
}
