import { Context, Next } from 'hono';
import { Errors } from '../errors';

/**
 * Design System 0520 subsystem C phase 1 task 1.3 — role-alias shim.
 *
 * Spec C introduces 4 explicit roles (lead / specialist / apprentice /
 * office) alongside the legacy 'inspector' role. Per
 * `feedback_pre_launch_no_compat`, no migration story is required — but
 * the single 1-line alias `inspector → lead` is a low-cost ergonomic
 * win that lets all existing inspector-* permission checks Just Work
 * for the new 'lead' role without doubling up on `allowedRoles` arrays
 * at every callsite.
 *
 * Future writers should call normaliseRole() when comparing role values
 * against an allow-list. Callsites pre-dating this shim continue to
 * work by virtue of the requireRole() middleware running normalisation
 * before its includes() check.
 */
export const ROLE_ALIASES: Record<string, string> = {
    'inspector': 'lead',
};

export function normaliseRole(role: string): string {
    return ROLE_ALIASES[role] ?? role;
}

// Middleware to enforce specific roles based on the decoded JWT
export const requireRole = (allowedRoles: string[]) => {
    // Expand the allow-list so callers can pass either 'inspector' or 'lead'
    // and we accept both — bidirectional aliasing.
    const expanded = new Set<string>(allowedRoles);
    for (const [from, to] of Object.entries(ROLE_ALIASES)) {
        if (expanded.has(to))   expanded.add(from);
        if (expanded.has(from)) expanded.add(to);
    }

    return async (c: Context, next: Next) => {
        const userRole = c.get('userRole'); // Populated by authMiddleware earlier
        if (!userRole) throw Errors.Unauthorized('No role found in context');

        if (!expanded.has(userRole) && !expanded.has(normaliseRole(userRole))) {
            throw Errors.Forbidden(`Requires one of [${allowedRoles.join(', ')}]`);
        }
        return next();
    };
};
