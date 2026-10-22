import type { SessionInfo } from "@core/field-ui/data-source";
import { resolveDisplayPrefs } from "@core/field-ui/shared/display-prefs";
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

/** Values the editor's own loader supplies; none of them come from the session context. */
export interface SessionLoaderBits {
    tenantSlug: string | null;
    videoProvider: "r2" | "stream";
    streamCustomerSubdomain: string | null;
    collabEditing: boolean;
}

/**
 * Stop-gap for `SessionInfo.userId` when the context carries no marker. This is the
 * literal the editor route hard-codes for presence today (`inspection-edit.tsx`).
 */
export const STOPGAP_USER_ID = "current-user";

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
 * The editor routes sit OUTSIDE `routes/auth-layout`, so the context is null there
 * today and every one of those answers is its fallback (en-US, UTC, us, 12h). Feeding
 * real values to the editor is a separate decision with its own Chrome date check.
 *
 * Stop-gaps, both because the editor has no session context today:
 * - `userId`: the context's opaque session marker if there is one, else
 *   `STOPGAP_USER_ID`. The marker is per-user and stable, which is what presence needs;
 *   it is not the user's database id.
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
        userId: ctx?.user.sessionMarker || STOPGAP_USER_ID,
        role: ctx?.user.role ?? "",
        locale: ctx?.user.locale || ctx?.branding.defaultLocale || "en-US",
        timeZone: ctx?.user.timezone || ctx?.branding.defaultTimezone || "UTC",
        dateFormat: viewer.dateFormat,
        timeFormat: viewer.timeFormat,
        tenantDateFormat: tenant.dateFormat,
        tenantTimeFormat: tenant.timeFormat,
    };
}
