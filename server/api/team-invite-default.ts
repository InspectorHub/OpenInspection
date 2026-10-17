import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { tenantConfigs } from '../lib/db/schema';
import { getDrizzle } from '../lib/route-helpers';
import { withNewInspectorDefault } from '../lib/team/new-inspector-default';
import type { Role } from '../lib/auth/roles';
import type { AppliedTemplate } from '../services/team/permission-templates.service';
import type { RequestedOverrides } from '../services/team/plan-member-update';
import type { HonoConfig } from '../types/hono';

export { inspectionScopeOf } from '../lib/team/new-inspector-default';

/**
 * The switches an invite request carries once the company default for new inspectors is applied
 * (`withNewInspectorDefault` says when and why). The default is read only for an inspector invite,
 * and only here, at creation: nothing reads it again for an invite that already exists.
 */
export async function requestedWithCompanyDefault(
    c: Context<HonoConfig>,
    args: { applied: AppliedTemplate | null; requestedRole: Role | undefined; requested: RequestedOverrides | null | undefined },
): Promise<RequestedOverrides | null | undefined> {
    const role = args.applied?.role ?? args.requestedRole ?? 'inspector';
    if (role !== 'inspector') return args.requested;
    const tenantId = c.get('tenantId');
    const row = await getDrizzle(c).select({ viewsAll: tenantConfigs.newInspectorsViewAll })
        .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
    return withNewInspectorDefault({
        role, requested: args.requested, template: args.applied?.permissionOverrides, companyViewsAll: row?.viewsAll !== false,
    });
}
