import type { Role } from '../lib/auth/roles';

export interface User {
    sub: string;
    role: Role;
    // Agent Accounts A1 — tenantId is undefined for global agent accounts
    // (role='agent'). Each agent route resolves the active tenant per-request
    // via `resolveAgentTenant()`.
    tenantId?: string;
}

export type UserRole = Role;

export interface BrandingConfig {
    companyName: string;
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
    /** PR 2 — tenant slug (path segment). Needed for path-tenant booking
     *  URLs (`<host>/book/<tenant>/<slug>`). Populated by inspectorPaletteMiddleware. */
    tenantSlug?: string | null | undefined;
    /** SaaS mode flag — true when this worker runs as `APP_MODE=saas`.
     *  Plumbed via brandingMiddleware so layouts can render the "Switch
     *  workspace" affordance (the only way for a multi-workspace identity
     *  to leave the current tenant) and so the login/forgot-password
     *  handlers can 302 to the portal-issued sign-in flow instead of
     *  presenting a local form that can no longer disambiguate which
     *  `(tenantId, email)` row to authenticate against. */
    isSaas?: boolean | undefined;
    /** Portal base URL exposed to the browser for the "Switch workspace"
     *  link and login bounce. Resolved from the portal base URL at request
     *  time. Null when running standalone or when the portal URL is
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
    requestedTenantSlug?: string;
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
