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
  };
  user: {
    name: string | null;
    email: string | null;
    role: string;
    initials: string;
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
