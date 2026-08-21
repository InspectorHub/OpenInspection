import { useRouteLoaderData } from "react-router";
import type { Capability, CapabilitySet } from "../../server/lib/auth/capabilities";
import {
  resolveDisplayPrefs,
  type DateFormat,
  type TimeFormat,
} from "../../server/lib/session/display-prefs";

/**
 * Session context returned by GET /api/session/context.
 * Contains branding, user info, deployment mode, and seat usage
 * for conditional UI features across the authenticated layout.
 */
export interface SessionContext {
  branding: {
    companyName: string;
    primaryColor: string;
    logoUrl: string | null;
    defaultProfileId: string;
    isSaas: boolean;
    portalBaseUrl: string | null;
    tenantSlug: string | null;
    tenantStatus: string;
    currentUserSlug: string | null;
    bookingHost: string | null;
    /** Effective Privacy URL for this tenant (hosted /legal/… or custom). */
    privacyUrl: string | null;
    /** Effective Terms URL for this tenant. */
    termsUrl: string | null;
    /** Tenant default display timezone (IANA name; 'UTC' when unset). */
    defaultTimezone: string;
    /** Tenant default display locale (BCP-47; 'en-US' when unset). */
    defaultLocale: string;
    /** Tenant transaction/display currency (ISO 4217; 'USD' when unset). */
    currency: string;
    /** Tenant default date order — see #270. Never null; 'us' when unset. */
    dateFormat: DateFormat;
    /** Tenant default clock — see #270. Never null; '12h' when unset. */
    timeFormat: TimeFormat;
  };
  user: {
    name: string | null;
    email: string | null;
    role: string;
    initials: string;
    /** Per-user timezone override (IANA name), or null to inherit the tenant. */
    timezone: string | null;
    /** Per-user locale override (BCP-47), or null to inherit the tenant. */
    locale: string | null;
    /** Per-user date-order override, or null to inherit the tenant (#270). */
    dateFormat: DateFormat | null;
    /** Per-user clock override, or null to inherit the tenant (#270). */
    timeFormat: TimeFormat | null;
    /**
     * The viewer's RESOLVED capabilities — role defaults with their personal
     * overrides already applied, computed by the same `getCapabilities` the API
     * guards use. Resolved server-side on purpose: the chrome must never work
     * out a second answer to a question the server already decided.
     */
    capabilities: CapabilitySet;
  };
  /**
   * Deployment capabilities the chrome may gate on.
   *
   * Kept in step with `deploymentPayload` in `server/api/session-context.ts`,
   * which is the allowlist that decides what actually ships. A capability
   * missing from that function is not readable here at any price — which is how
   * two surfaces came to gate the marketplace on `branding.isSaas` while the
   * page itself gated it on `hasContentMarketplace`.
   */
  deployment: {
    mode: string;
    hasBilling: boolean;
    hasSeatQuota: boolean;
    mcpEnabled: boolean;
    hasContentMarketplace: boolean;
    videoBackendManaged: boolean;
    hasManagedCompliance: boolean;
    /** Whether the import wizard may offer to hand an unreadable file to a
     *  person. False self-hosted, where the route does not exist at all. */
    hasAssistedMigration: boolean;
  };
  seatUsage: { used: number; limit: number } | null;
  /**
   * Portal #98 — non-null ONLY while the 24-hour outbound cooling window is
   * open, carrying the instant it closes. Null on a self-hosted deployment,
   * once the window has elapsed, and when the server could not read the
   * anchor. The client never computes any of that; it renders what it is told.
   */
  outboundCoolingWindow: { unlockAtMs: number } | null;
}

/**
 * Access the session context from any child route of auth-layout.
 * Returns null when context is unavailable (e.g. fetch failed).
 */
/** Unread counterparty messages across the tenant (sidebar badge). */
export function useUnreadMessages(): number {
  const ctx = useSessionContext();
  return (ctx as (SessionContext & { unreadMessages?: number }) | null)?.unreadMessages ?? 0;
}

/**
 * One capability answer for the current viewer.
 *
 * FAIL-CLOSED when there is no context (outside the auth layout, or the fetch
 * failed): a chrome entry that appears on a failed load is an entry that
 * navigates to a 403. The server is the enforcer either way; this only decides
 * whether to offer the door.
 */
export function useCapability(capability: Capability): boolean {
  return useSessionContext()?.user.capabilities?.[capability] === true;
}

/** Every resolved capability, for callers filtering a list. */
export function useCapabilities(): Partial<CapabilitySet> | null {
  return useSessionContext()?.user.capabilities ?? null;
}

export function useSessionContext(): SessionContext | null {
  const data = useRouteLoaderData("routes/auth-layout") as
    | { context: SessionContext | null }
    | undefined;
  return data?.context ?? null;
}

/**
 * The resolved display timezone for the current viewer: the user's override
 * when set, otherwise the tenant default, otherwise 'UTC'. Values are already
 * validated to real IANA ids on write (branding/profile APIs). The calendar
 * renders in this zone — the server buckets calendar items into the same
 * effective tz (GET /api/calendar/items), so the client never re-derives days.
 * Reports still anchor to the tenant tz, not this per-viewer value.
 */
export function useDisplayTimeZone(): string {
  const ctx = useSessionContext();
  return ctx?.user.timezone || ctx?.branding.defaultTimezone || "UTC";
}

/** Resolved display locale for the current viewer: user override, else tenant
 *  default, else 'en-US'. Mirrors useDisplayTimeZone. */
export function useDisplayLocale(): string {
  const ctx = useSessionContext();
  return ctx?.user.locale || ctx?.branding.defaultLocale || "en-US";
}

/** Tenant transaction/display currency (ISO 4217); 'USD' when unset. */
export function useDisplayCurrency(): string {
  const ctx = useSessionContext();
  return ctx?.branding.currency || "USD";
}

/**
 * The viewer's effective date order and clock (#270) — user override, else
 * tenant default, else 'us' + '12h', decided PER FIELD. Mirrors
 * useDisplayTimeZone: no context (outside the auth layout, or the fetch failed)
 * yields the defaults rather than throwing, so the chrome always renders.
 *
 * This is WORKSPACE CHROME only. Anything a second party also reads —
 * inspection dates, report dates, appointment times — must resolve from the
 * tenant alone, because the inspector, the client and the agent discuss one
 * inspection out loud and must say the same date.
 *
 * Deliberately NOT exported: a caller wanting the shape also wants the
 * language, and getting one without the other is how a Spanish page ends up
 * with an English month. `useChromeDateTimeFormat` below is the whole bundle.
 */
function useDisplayFormatPrefs(): { dateFormat: DateFormat; timeFormat: TimeFormat } {
  const ctx = useSessionContext();
  return resolveDisplayPrefs(ctx?.user, ctx?.branding);
}

/**
 * The format bundle for WORKSPACE CHROME — settings panels, diagnostics logs,
 * version history: surfaces whose reader is the person looking at them (#270).
 *
 * Counterpart to `useInspectionDateTimeFormat` below, and the difference is the
 * whole design: here BOTH axes follow the viewer, because nobody else is
 * reading this value off a different screen at the same time.
 */
export function useChromeDateTimeFormat(): {
  locale: string;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
} {
  const locale = useDisplayLocale();
  const prefs = useDisplayFormatPrefs();
  return { locale, ...prefs };
}

/**
 * The TENANT's date order and clock, ignoring any personal override — the
 * resolution for inspection / report / appointment rendering.
 */
export function useTenantFormatPrefs(): { dateFormat: DateFormat; timeFormat: TimeFormat } {
  const ctx = useSessionContext();
  return resolveDisplayPrefs(null, ctx?.branding);
}

/**
 * The format bundle for anything a SECOND PARTY also reads — inspection dates,
 * report dates, appointment times (#270).
 *
 * The two axes resolve from different places on purpose. **Language** follows
 * the viewer, because a Spanish-speaking agent should read Spanish. **Shape**
 * follows the tenant, because `Sep 11` on one screen and `11/09` on another is
 * a support call and, on a date-sensitive transaction, a missed appointment.
 * Translating a month name cannot be misread; reordering one can.
 */
export function useInspectionDateTimeFormat(): {
  locale: string;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
} {
  const locale = useDisplayLocale();
  const prefs = useTenantFormatPrefs();
  return { locale, ...prefs };
}
