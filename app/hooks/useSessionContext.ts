import { useRouteLoaderData } from "react-router";

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
    reportTheme: string;
    isSaas: boolean;
    portalBaseUrl: string | null;
    tenantSlug: string | null;
    tenantStatus: string;
    currentUserSlug: string | null;
    bookingHost: string | null;
    /** PRIVACY_URL env value (operator-configured), or null when unset. */
    privacyUrl: string | null;
    /** Tenant default display timezone (IANA name; 'UTC' when unset). */
    defaultTimezone: string;
  };
  user: {
    name: string | null;
    email: string | null;
    role: string;
    initials: string;
    /** Per-user timezone override (IANA name), or null to inherit the tenant. */
    timezone: string | null;
  };
  deployment: {
    mode: string;
    hasBilling: boolean;
    hasSeatQuota: boolean;
    mcpEnabled: boolean;
  };
  seatUsage: { used: number; limit: number } | null;
}

/**
 * Access the session context from any child route of auth-layout.
 * Returns null when context is unavailable (e.g. fetch failed).
 */
export function useSessionContext(): SessionContext | null {
  const data = useRouteLoaderData("routes/auth-layout") as
    | { context: SessionContext | null }
    | undefined;
  return data?.context ?? null;
}

/**
 * The resolved display timezone for the current viewer: the user's override
 * when set, otherwise the tenant default, otherwise 'UTC'. Values are already
 * validated to real IANA ids on write (branding/profile APIs). Reports and
 * calendar events do NOT use this — they always anchor to the tenant tz.
 */
export function useDisplayTimeZone(): string {
  const ctx = useSessionContext();
  return ctx?.user.timezone || ctx?.branding.defaultTimezone || "UTC";
}
