import { Errors } from '../../lib/errors';
import type { Role } from '../../lib/auth/roles';
import type { PermissionOverrides } from '../../lib/auth/capabilities';
import { layerOverrides } from '../../lib/auth/permission-templates';
import type { AppliedTemplate } from './permission-templates.service';
import type { RequestedOverrides } from './plan-member-update';

/**
 * What an invite or a member edit asks for once a template may be involved.
 *
 * Without a template the request stands as written. With one, the order is: the
 * role's defaults, then the template's switches, then the switches the requester
 * sent on top. The template's role is the role; naming a different one alongside
 * it is a contradiction and is refused rather than guessed at, because "start from
 * the trainee template but as a manager" has no honest reading.
 *
 * The result goes through the normal invite or update path, so the role ceiling,
 * the capability ceiling and the owner guard apply to a template exactly as they
 * apply to the same role and switches typed in by hand.
 */
export function applyTemplateToRequest(args: {
    applied: AppliedTemplate | null;
    requestedRole: Role | undefined;
    requestedOverrides: RequestedOverrides | null | undefined;
}): { role: Role | undefined; overrides: RequestedOverrides | null | undefined } {
    const { applied, requestedRole, requestedOverrides } = args;
    if (!applied) return { role: requestedRole, overrides: requestedOverrides };
    if (requestedRole && requestedRole !== applied.role) {
        throw Errors.BadRequest(
            `The "${applied.name}" template is for the ${applied.role} role, but ${requestedRole} was asked for. Leave the role out to use the template's, or choose a different template.`,
        );
    }
    const stamped: PermissionOverrides | null = layerOverrides(applied.role, applied.permissionOverrides, requestedOverrides);
    return { role: applied.role, overrides: stamped };
}
