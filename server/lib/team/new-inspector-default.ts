import { getCapabilities, type PermissionOverrides } from '../auth/capabilities';
import type { Role } from '../auth/roles';
import type { RequestedOverrides } from '../../services/team/plan-member-update';

/**
 * The company default for whether a NEW inspector sees every inspection, applied when an invite is created.
 *
 * It is stamped onto the invite and read from nowhere afterwards: changing the default never touches an
 * existing member or a pending invite, and an invite that already says something about the scope keeps what
 * it says. "Says something" means the request carries the switch with a value (an explicit `true` beats a
 * default of `false`, which is the only way to invite an inspector who sees everything into a company that
 * restricts new ones), or a permission template that carries it.
 *
 * A template's switches are stored as a difference from its role, so a template that spells out `true` for
 * the scope is indistinguishable from one that does not mention it; both take the default. A person who
 * wants the opposite sends the switch explicitly, as the Team page does.
 *
 * Only inspectors are affected: every other role pins the scope.
 */
export function withNewInspectorDefault(args: {
    role: Role;
    requested: RequestedOverrides | null | undefined;
    template: PermissionOverrides | null | undefined;
    /** The company default: true when new inspectors see every inspection (the default for every company). */
    companyViewsAll: boolean;
}): RequestedOverrides | null | undefined {
    const { role, requested, template, companyViewsAll } = args;
    if (role !== 'inspector' || companyViewsAll) return requested;
    if (typeof requested?.viewAllInspections === 'boolean') return requested;
    if (typeof template?.viewAllInspections === 'boolean') return requested;
    return { ...(requested ?? {}), viewAllInspections: false };
}

/** What the invite grants for the scope, named for the audit trail: 'all' or 'assigned'. */
export function inspectionScopeOf(role: Role, overrides: RequestedOverrides | null | undefined): 'all' | 'assigned' {
    const stated = overrides?.viewAllInspections;
    return getCapabilities(role, typeof stated === 'boolean' ? { viewAllInspections: stated } : null).viewAllInspections ? 'all' : 'assigned';
}
