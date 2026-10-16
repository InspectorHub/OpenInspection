/**
 * Roles that may hold a booking schedule / be restricted per-service. Used by
 * the Services and Online Booking settings pages, which both filter the member
 * list down to these roles before rendering schedule/qualification pickers.
 */
import { FIELD_ROLES } from "../../../server/lib/auth/roles";

// The server's own list of roles that can be the inspector on a job, not a second copy of it.
export const SCHEDULING_ROLES = FIELD_ROLES;

/** Set form for `.has()` membership checks. */
export const SCHEDULING_ROLES_SET = new Set<string>(SCHEDULING_ROLES);
