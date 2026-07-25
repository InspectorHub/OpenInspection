/**
 * Services catalog helpers (Settings → Services).
 *
 * A service row carries three things the product consumes and one the admin can
 * see: name and price were the only two the create form could set, so the
 * DURATION column rendered an em dash for every row, and every service was
 * unbookable online. These helpers are the pure parts of filling that gap.
 */

/** A service as far as bookability is concerned. */
export interface TemplateBearing {
    templateId?: string | null;
}

/**
 * Split a stored duration into hours + minutes for display, or null when the
 * service carries none.
 *
 * A missing duration is NOT zero: public booking sums `durationMinutes` across
 * the selected services and falls back to the configured time-slot length when
 * the sum is zero, so "not set" and "0 min" mean different things to the
 * scheduler. Fractional minutes cannot come from the form (step=5, integer
 * validation) but can exist in older rows, so they're floored rather than
 * rendered as "1 hr 30.5 min".
 */
export function splitDurationMinutes(
    total: number | null | undefined,
): { hours: number; minutes: number } | null {
    if (total == null || !Number.isFinite(total) || total <= 0) return null;
    const whole = Math.floor(total);
    return { hours: Math.floor(whole / 60), minutes: whole % 60 };
}

/**
 * Can a customer book this service online?
 *
 * A booking that selects services creates one inspection per service, built
 * from that service's template — see BookingService's multi-service branch,
 * which throws `Service 'X' has no template configured.` for a blank one. That
 * BadRequest surfaces on the public booking page, so a service the admin cannot
 * see is misconfigured takes the whole booking down with it.
 */
export function serviceIsBookable(svc: TemplateBearing): boolean {
    return typeof svc.templateId === "string" && svc.templateId.length > 0;
}

/**
 * Did THIS action result come from a successful create-service?
 *
 * The route's action answers `{ ok: true }` from the toggle-service branch and
 * from its fallback, and a Conform validation failure replies with a `status`
 * field instead. The create form closes and clears on success, so it has to
 * recognise its own result specifically: closing on a bare `{ ok: true }` would
 * throw away whatever the admin had typed the moment they toggled another row.
 */
export function didCreateService(actionData: unknown): boolean {
    if (!actionData || typeof actionData !== "object") return false;
    const d = actionData as { ok?: unknown; intent?: unknown };
    return d.ok === true && d.intent === "create-service";
}
