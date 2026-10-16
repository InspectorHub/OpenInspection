import { getCapabilities, type PermissionOverrides } from '../../../server/lib/auth/capabilities';
import type { GrantActor } from '../../../server/lib/auth/grant-ceiling';
import type { Role } from '../../../server/lib/auth/roles';

/** An acting person as the grant ceiling sees them: a role plus that role's resolved capabilities. */
export function actorOf(role: Role, overrides: PermissionOverrides | null = null): GrantActor {
    return { role, capabilities: getCapabilities(role, overrides) };
}

export const OWNER_ACTOR: GrantActor = actorOf('owner');
