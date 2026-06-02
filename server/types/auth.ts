export interface User {
    sub: string;
    /**
     * Subsystem C P5 extended the role surface from the legacy 3-role
     * model (owner/admin/inspector) to a 4-role inspector hierarchy
     * (lead/specialist/apprentice/office). `inspector` is retained as a
     * legacy alias for `lead` and is normalised by ROLE_ALIASES in
     * server/lib/middleware/rbac.ts so existing tokens keep verifying.
     */
    role: 'owner' | 'admin' | 'inspector' | 'agent'
        | 'lead' | 'specialist' | 'apprentice' | 'office';
    // Agent Accounts A1 — tenantId is undefined for global agent accounts
    // (role='agent'). Each agent route resolves the active tenant per-request
    // via `resolveAgentTenant()`.
    tenantId?: string;
}

export type UserRole = User['role'];

export interface BrandingConfig {
    siteName: string;
    primaryColor: string;
    logoUrl: string | null;
    supportEmail: string;
    billingUrl: string;
    reportTheme?: 'modern' | 'classic' | 'minimal' | undefined;
    /** Sprint B-1 — signed-in user's booking slug. Plumbed via the
     *  inspectorPaletteMiddleware so MainLayout can pass it to
     *  <CommandPalette /> for the "Copy my booking link" action. Null when
     *  the user hasn't picked a slug yet. */
    currentUserSlug?: string | null | undefined;
    /** Sprint B-1 — host portion of the booking URL (e.g. "acme.inspectorhub.io").
     *  Used by the ⌘K palette action and any other slug-aware UI. */
    bookingHost?: string | undefined;
    /** PR 2 — tenant subdomain (path segment). Needed for path-tenant booking
     *  URLs (`<host>/book/<tenant>/<slug>`). Populated by inspectorPaletteMiddleware. */
    tenantSubdomain?: string | null | undefined;
    /** SaaS mode flag — true when this worker runs as `APP_MODE=saas`.
     *  Plumbed via brandingMiddleware so layouts can render the "Switch
     *  workspace" affordance (the only way for a multi-workspace identity
     *  to leave the current tenant) and so the login/forgot-password
     *  handlers can 302 to the portal-issued sign-in flow instead of
     *  presenting a local form that can no longer disambiguate which
     *  `(tenantId, email)` row to authenticate against. */
    isSaas?: boolean | undefined;
    /** Portal base URL exposed to the browser for the "Switch workspace"
     *  link and login bounce. Resolved from `PORTAL_API_URL` at request
     *  time. Null when running standalone or when `PORTAL_API_URL` is
     *  unset (in which case the bounce/switch UI degrades to a no-op). */
    portalBaseUrl?: string | null | undefined;
    /** Current tenant lifecycle status. Used by MainLayout to show a
     *  suspension banner when status === 'suspended'. */
    tenantStatus?: string | undefined;
}

import { ScopedDB } from '../lib/db/scoped';
import type { JwtKeyring } from '../lib/jwt-keyring';

export interface AuthVariables {
    tenantId: string;
    resolvedTenantId?: string; // Explicitly tracked for isolation guard
    user: User;
    userRole: UserRole;
    // Agent Accounts A1 — set by JWT middleware on the role=agent branch.
    // Mirrors `user.sub` but lets agent-only handlers stay narrowly typed
    // without re-deriving from the broader User payload.
    agentUserId?: string;
    requestedSubdomain?: string;
    tenantTier?: string;
    tenantStatus?: string;
    branding?: BrandingConfig;
    sdb?: ScopedDB;
    /** Lazy-built ES256 keyring (one per request). Resolves to a JwtKeyring
     *  with private/public keys imported once. Handlers that sign or verify
     *  JWTs should `await c.var.keyringPromise`. */
    keyringPromise?: Promise<JwtKeyring>;
}

export interface InspectionData {
    sections: Array<{
        id: string;
        title: string;
        items: Array<{
            id: string;
            label: string;
            description?: string;
            status?: 'Satisfactory' | 'Monitor' | 'Defect' | 'Not Inspected';
            notes?: string;
            photos?: Array<{
                key: string;
                pending?: boolean;
                dataUrl?: string;
            }>;
        }>;
    }>;
}
