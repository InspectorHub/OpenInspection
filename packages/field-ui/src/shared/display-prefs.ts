/**
 * Date/time SHAPE resolution — see #270. Sibling to server/lib/locale.ts and
 * server/lib/tz.ts, and the third of the four independent display preferences
 * (language, timezone, currency, shape).
 *
 * Shape is its own axis because no locale expresses "English words, American
 * order, 24-hour clock", and that is a normal field preference: 14:30 is
 * unambiguous over a radio where "2:30" is not.
 *
 * Resolution is per FIELD, not per object. A user who set only the clock keeps
 * the tenant's date order; collapsing to a per-object choice silently reverts a
 * preference the user did set.
 *
 * The drizzle `{ enum: [...] }` is type-layer only — D1 stores plain TEXT with
 * no CHECK constraint — so an unrecognized stored value falls back rather than
 * reaching `Intl` as an unknown key.
 */

export const DATE_FORMATS = ['us', 'iso', 'eu'] as const;
export const TIME_FORMATS = ['12h', '24h'] as const;

export type DateFormat = (typeof DATE_FORMATS)[number];
export type TimeFormat = (typeof TIME_FORMATS)[number];

export interface DisplayFormatPrefs {
    dateFormat: DateFormat;
    timeFormat: TimeFormat;
}

/**
 * The bottom of the resolution chain. These reproduce today's rendering
 * exactly, so a tenant that never touches the setting sees no change.
 */
export const DEFAULT_DISPLAY_PREFS: DisplayFormatPrefs = { dateFormat: 'us', timeFormat: '12h' };

/** A row (user or tenant_configs) contributing either preference. */
export interface DisplayFormatSource {
    dateFormat?: string | null;
    timeFormat?: string | null;
}

export function isDateFormat(raw: unknown): raw is DateFormat {
    return typeof raw === 'string' && (DATE_FORMATS as readonly string[]).includes(raw);
}

export function isTimeFormat(raw: unknown): raw is TimeFormat {
    return typeof raw === 'string' && (TIME_FORMATS as readonly string[]).includes(raw);
}

/**
 * Resolve the viewer's effective date/time shape: user override, else tenant
 * default, else the built-in default — decided independently for each field.
 *
 * Callers rendering anything a SECOND PARTY also sees (inspection dates, report
 * dates, appointment times) must pass `null` for `user` and resolve from the
 * tenant alone: the inspector, the client and the agent discuss one inspection
 * by phone, and a per-viewer shape turns that into a support call.
 */
export function resolveDisplayPrefs(
    user: DisplayFormatSource | null | undefined,
    tenant: DisplayFormatSource | null | undefined,
): DisplayFormatPrefs {
    return {
        dateFormat: isDateFormat(user?.dateFormat)
            ? user.dateFormat
            : isDateFormat(tenant?.dateFormat)
                ? tenant.dateFormat
                : DEFAULT_DISPLAY_PREFS.dateFormat,
        timeFormat: isTimeFormat(user?.timeFormat)
            ? user.timeFormat
            : isTimeFormat(tenant?.timeFormat)
                ? tenant.timeFormat
                : DEFAULT_DISPLAY_PREFS.timeFormat,
    };
}
