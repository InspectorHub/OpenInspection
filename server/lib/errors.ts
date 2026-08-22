import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Standard error codes for consistent API responses.
 * These codes are machine-readable for the frontend.
 */
export enum ErrorCode {
    BAD_REQUEST = 'bad_request',
    UNAUTHORIZED = 'unauthorized',
    FORBIDDEN = 'forbidden',
    NOT_FOUND = 'not_found',
    VALIDATION_ERROR = 'validation_error',
    CONFLICT = 'conflict',
    UNPROCESSABLE_ENTITY = 'unprocessable_entity',
    RATE_LIMITED = 'rate_limited',
    SEAT_LIMIT_REACHED = 'seat_limit_reached',
    INTERNAL_ERROR = 'internal_error',
    SERVICE_UNAVAILABLE = 'service_unavailable',
    // Sprint 1 Sub-spec A Task 6 — distinct code for missing AI key so the
    // client can surface a clear "open AI settings" path instead of a
    // generic 503.
    AI_NOT_CONFIGURED = 'ai_not_configured',
    TENANT_SUSPENDED = 'tenant_suspended',
    // Free-tier usage-quota exhaustion (inspections / sms / email). Contract:
    // payload carries metric/used/cap/billingPortalUrl — see Errors.QuotaExhausted.
    QUOTA_EXHAUSTED = 'QUOTA_EXHAUSTED',
    // Commercial PCA Phase M — sign-off / PSQ writes require the inspection's
    // report_tier to already be 'full_pca' (Phase T elevation). Distinct code
    // so the editor can surface a "elevate to Full PCA first" prompt instead
    // of a generic conflict.
    TIER_NOT_FULL_PCA = 'TIER_NOT_FULL_PCA',
    // Portal #98 §3.2 — the first-24-hours cooling window on platform-funded
    // outbound email. A distinct code, not a generic 403, for two readers: the
    // UI renders the "what still works + BYO escape hatch" copy off it, and an
    // operator reading logs can tell a deliberate refusal from a provider outage.
    OUTBOUND_COOLING_WINDOW = 'OUTBOUND_COOLING_WINDOW',
    // An authenticated agent has no acceptance of the agent terms in force. A
    // code of its own, not a 401 or a 403, because the three answer different
    // questions and the client has to tell them apart: 401 says "sign in", 403
    // says "you may not do this at all", and this one says "you are signed in,
    // your account is fine, and there is one document to read first". Collapsing
    // it into either of the others would send the agent back to a login page
    // they just came from, or to a dead end with no action available.
    AGENT_TERMS_REQUIRED = 'AGENT_TERMS_REQUIRED',
}

/**
 * Custom application error class that carries an HTTP status code
 * and a machine-readable error code.
 */
export class AppError extends Error {
    constructor(
        public status: ContentfulStatusCode,
        public code: ErrorCode,
        public message: string,
        public details?: unknown
    ) {
        super(message);
        this.name = 'AppError';
    }
}

/**
 * Factory for common errors.
 */
export const Errors = {
    BadRequest: (msg: string, details?: unknown) => new AppError(400, ErrorCode.BAD_REQUEST, msg, details),
    Unauthorized: (msg: string = 'Unauthorized access') => new AppError(401, ErrorCode.UNAUTHORIZED, msg),
    Forbidden: (msg: string = 'Action forbidden') => new AppError(403, ErrorCode.FORBIDDEN, msg),
    NotFound: (msg: string = 'Resource not found') => new AppError(404, ErrorCode.NOT_FOUND, msg),
    Validation: (details: unknown) => new AppError(400, ErrorCode.VALIDATION_ERROR, 'Validation failed', details),
    Conflict: (msg: string) => new AppError(409, ErrorCode.CONFLICT, msg),
    UnprocessableEntity: (msg: string, details?: unknown) =>
        new AppError(422, ErrorCode.UNPROCESSABLE_ENTITY, msg, details),
    RateLimited: (msg: string = 'Too many attempts. Please try again later.') => new AppError(429, ErrorCode.RATE_LIMITED, msg),
    // `needed` is optional so the single-seat message stays exactly what it
    // was; a bulk caller supplies it and gets a sentence with both numbers,
    // because "seat limit reached" gives an operator staging twelve invites
    // nothing to act on.
    SeatLimitReached: (details: { used: number; max: number; billingPortalUrl: string | null; needed?: number }) =>
        new AppError(
            402,
            ErrorCode.SEAT_LIMIT_REACHED,
            details.needed === undefined
                ? 'Your team has reached its seat limit. Upgrade your plan to invite more members.'
                : `This import needs ${details.needed} seats and ${Math.max(0, details.max - details.used)} are available. ` +
                  'Upgrade your plan, or import fewer people.',
            details,
        ),
    Internal: (msg: string = 'Internal server error') => new AppError(500, ErrorCode.INTERNAL_ERROR, msg),
    ServiceUnavailable: (msg: string, details?: unknown) => new AppError(503, ErrorCode.SERVICE_UNAVAILABLE, msg, details),
    AINotConfigured: (msg: string = 'AI is not configured. Set GEMINI_API_KEY in Settings.') =>
        new AppError(503, ErrorCode.AI_NOT_CONFIGURED, msg),
    TenantSuspended: (msg: string = 'This workspace has been suspended. Existing content remains accessible in read-only mode. Contact your administrator to restore full access.') =>
        new AppError(403, ErrorCode.TENANT_SUSPENDED, msg),
    QuotaExhausted: (details: { metric: string; used: number; cap: number; billingPortalUrl: string | null }) =>
        new AppError(
            402,
            ErrorCode.QUOTA_EXHAUSTED,
            `Free plan limit reached: ${details.used}/${details.cap} ${details.metric}. Subscribe to continue.`,
            details,
        ),
    TierNotFullPca: (msg: string = 'This action requires the inspection report tier to be full_pca.') =>
        new AppError(409, ErrorCode.TIER_NOT_FULL_PCA, msg),
    // 403 rather than 402/429 deliberately: this is not a quota and not a rate
    // limit, it is a permission that has not vested yet. The CODE, not the
    // status, is what distinguishes it.
    OutboundCoolingWindow: (details: { unlockAtMs: number; windowHours: number }) =>
        new AppError(
            403,
            ErrorCode.OUTBOUND_COOLING_WINDOW,
            `New companies cannot send client email on the shared sender for the first ${details.windowHours} hours. Everything else works, and connecting your own email provider removes the wait entirely.`,
            details,
        ),
    /**
     * 428 Precondition Required — the request must satisfy a precondition the
     * caller can meet, and the body says which one.
     *
     * 428 rather than 401/403: the session is valid and the account is in good
     * standing, so neither of those is true. It is also unused anywhere else in
     * this API, so a 428 on an agent route means this and nothing else — checked
     * before adopting it, because a status shared with a second meaning is a
     * status a client cannot branch on.
     *
     * `details.acceptPath` is in the payload rather than assumed by the client:
     * the page that collects the acceptance is this deployment's, and a client
     * hard-coding the path would have to be redeployed to follow it.
     */
    AgentTermsRequired: (details: {
        /**
         * Which fact stopped the request. Only the two refusing states can reach
         * here — `NOT_IN_FORCE` and `ACCEPTED` both pass the gate, and the type
         * says so rather than leaving it to a comment.
         */
        state: 'REQUIRED' | 'UNREADABLE';
        /** What the agent can do about it. An outage is not their move to make. */
        reason: 'never_accepted' | 'superseded' | 'unreadable';
        acceptPath: string;
        requiredVersion: string | null;
    }) =>
        new AppError(
            428,
            ErrorCode.AGENT_TERMS_REQUIRED,
            'The agent terms in force have not been accepted on this account.',
            details,
        ),
};
