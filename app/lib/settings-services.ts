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
 * Did THIS action result come from the named save succeeding?
 *
 * The route's action answers `{ ok: true }` from the toggle-service branch and
 * from its fallback, and a Conform validation failure replies with a `status`
 * field instead. Each form closes on success, so it has to recognise its OWN
 * result: closing on a bare `{ ok: true }` would throw away whatever the admin
 * had typed the moment they toggled another row, and a create form that closed
 * on an update's result (or the reverse) would do the same.
 */
export function didSaveService(
    actionData: unknown,
    intent: "create-service" | "update-service",
): boolean {
    if (!actionData || typeof actionData !== "object") return false;
    const d = actionData as { ok?: unknown; intent?: unknown };
    return d.ok === true && d.intent === intent;
}

/* ------------------------------------------------------------------ */
/*  Pay rules (#278) — the human-units boundary                        */
/* ------------------------------------------------------------------ */

/**
 * The UI's half of the unit contract.
 *
 * The API speaks basis points and integer cents, and names both on the wire
 * (`percentBps`, `amountCents`) so neither can be sent in the wrong unit by
 * accident. A person types "60" meaning 60% and "125" meaning $125.00, so the
 * ×100 has to happen somewhere — and it happens HERE, one function, beside the
 * "%" and "$" the person can see, rather than being spread across a form
 * handler. Getting this wrong pays someone 0.6% of a job, which is why it is
 * a named function with a test rather than a `* 100` in a JSX callback.
 *
 * Returns null for anything that is not a positive number, so the caller can
 * refuse the submission instead of sending NaN.
 */
export function toHundredths(input: string | number | null | undefined): number | null {
    if (input === null || input === undefined || input === "") return null;
    const n = typeof input === "number" ? input : Number(String(input).trim());
    if (!Number.isFinite(n) || n <= 0) return null;
    // Round, not floor: 62.5% is 6250 bp exactly, and float multiplication
    // lands it at 6249.999999999999.
    return Math.round(n * 100);
}

/** The inverse, for filling the form from a stored rule. 6000 → "60", 6250 → "62.5". */
export function fromHundredths(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return "";
    return String(Math.round(value) / 100);
}
