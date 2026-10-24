import type { SessionInfo } from "@core/field-ui/data-source";
import { isDateFormat, isTimeFormat, resolveDisplayPrefs } from "@core/field-ui/shared/display-prefs";
import type { SessionContext } from "~/hooks/useSessionContext";

/**
 * The slice of `SessionContext` the field editor's `SessionInfo` is built from.
 * Structural on purpose: a caller (or a test) hands over whatever it has, and the
 * full `SessionContext` satisfies it.
 */
export interface SessionContextLike {
    user: Pick<SessionContext["user"], "role" | "timezone" | "locale" | "dateFormat" | "timeFormat"> & {
        sessionMarker?: string;
    };
    branding: Pick<SessionContext["branding"], "defaultTimezone" | "defaultLocale" | "dateFormat" | "timeFormat">;
}

const orNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * The editor's own copy of the viewer's display values, read from the session-context answer its loader
 * already fetches (the editor routes sit outside `routes/auth-layout`, so `useSessionContext()` is null
 * there). Defensive on purpose: an answer that does not carry both halves is no viewer (`null`), and any
 * single value that is missing or not recognised is left to the fallbacks in `webSessionInfo`.
 */
export function viewerFromSessionContext(data: unknown): SessionContextLike | null {
    const rec = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null);
    const root = rec(data);
    const user = rec(root?.user);
    const branding = rec(root?.branding);
    if (!user || !branding) return null;
    const marker = orNull(user.sessionMarker);
    return {
        user: {
            role: typeof user.role === "string" ? user.role : "",
            timezone: orNull(user.timezone),
            locale: orNull(user.locale),
            dateFormat: isDateFormat(user.dateFormat) ? user.dateFormat : null,
            timeFormat: isTimeFormat(user.timeFormat) ? user.timeFormat : null,
            ...(marker ? { sessionMarker: marker } : {}),
        },
        branding: {
            defaultTimezone: orNull(branding.defaultTimezone) ?? "UTC",
            defaultLocale: orNull(branding.defaultLocale) ?? "en-US",
            dateFormat: isDateFormat(branding.dateFormat) ? branding.dateFormat : "us",
            timeFormat: isTimeFormat(branding.timeFormat) ? branding.timeFormat : "12h",
        },
    };
}

/** Values the editor's own loader supplies; none of them come from the session context. */
export interface SessionLoaderBits {
    tenantSlug: string | null;
    videoProvider: "r2" | "stream";
    streamCustomerSubdomain: string | null;
    collabEditing: boolean;
}

/**
 * Build the editor's `SessionInfo` so that it answers EXACTLY what the existing
 * hooks answer for the same context (no behaviour change).
 *
 * The authority is `app/hooks/useSessionContext.ts`; the resolution is repeated here
 * rather than shared because that file is not edited in this batch.
 * the test next to this file renders the real hooks and compares, so drift fails there:
 * - `locale`     = `useDisplayLocale`:   user, else tenant, else "en-US"
 * - `timeZone`   = `useDisplayTimeZone`:  user, else tenant, else "UTC" (never null)
 * - `dateFormat` / `timeFormat` = `useChromeDateTimeFormat`: per field, viewer then tenant
 * - `tenantDateFormat` / `tenantTimeFormat` = `useTenantFormatPrefs`: tenant alone
 *
 * The editor routes sit OUTSIDE `routes/auth-layout`, so `useSessionContext()` is null
 * there; the host then hands over the viewer its loader read (`viewerFromSessionContext`).
 * With neither, every one of those answers is its fallback (en-US, UTC, us, 12h).
 *
 * - `userId`: the context's opaque session marker (per-user and stable, which is what
 *   presence needs; it is not the user's database id, which the session context does not
 *   carry), else null. There is deliberately NO shared placeholder id: with no identity the
 *   editor announces no presence, and nothing is attributed to a made-up user.
 * - `role`: the context's role if there is one, else "" (unknown). Nothing may treat ""
 *   as a privilege level.
 */
export function webSessionInfo(ctx: SessionContextLike | null, bits: SessionLoaderBits): SessionInfo {
    const viewer = resolveDisplayPrefs(ctx?.user, ctx?.branding);
    const tenant = resolveDisplayPrefs(null, ctx?.branding);
    return {
        tenantSlug: bits.tenantSlug,
        videoProvider: bits.videoProvider,
        streamCustomerSubdomain: bits.streamCustomerSubdomain,
        collabEditing: bits.collabEditing,
        userId: ctx?.user.sessionMarker || null,
        role: ctx?.user.role ?? "",
        locale: ctx?.user.locale || ctx?.branding.defaultLocale || "en-US",
        timeZone: ctx?.user.timezone || ctx?.branding.defaultTimezone || "UTC",
        dateFormat: viewer.dateFormat,
        timeFormat: viewer.timeFormat,
        tenantDateFormat: tenant.dateFormat,
        tenantTimeFormat: tenant.timeFormat,
    };
}
