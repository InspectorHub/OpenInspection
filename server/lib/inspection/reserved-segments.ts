/**
 * Static first segments under /api/inspections. They are routes, never inspection ids, so the
 * path guard does not look them up as ids and a client-generated id may not take one.
 * A test compares this set with the static segments the route table actually carries.
 */
export const RESERVED_INSPECTION_SEGMENTS: ReadonlySet<string> = new Set([
    'bulk', 'counts', 'dashboard', 'inspectors', 'schedule-conflicts', 'templates', 'wizard',
]);
