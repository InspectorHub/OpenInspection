/**
 * Roles that may hold a booking schedule / be restricted per-service. Used by
 * the Services and Online Booking settings pages, which both filter the member
 * list down to these roles before rendering schedule/qualification pickers.
 */
export const SCHEDULING_ROLES = ["owner", "manager", "inspector"] as const;

/** Set form for `.has()` membership checks. */
export const SCHEDULING_ROLES_SET = new Set<string>(SCHEDULING_ROLES);
