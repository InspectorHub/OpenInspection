import { ContentfulStatusCode } from 'hono/utils/http-status';

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
    SeatLimitReached: (details: { used: number; max: number; billingPortalUrl: string | null }) =>
        new AppError(
            402,
            ErrorCode.SEAT_LIMIT_REACHED,
            'Your team has reached its seat limit. Upgrade your plan to invite more members.',
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
};
