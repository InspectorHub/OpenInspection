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
    RATE_LIMITED = 'rate_limited',
    INTERNAL_ERROR = 'internal_error',
    SERVICE_UNAVAILABLE = 'service_unavailable'
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
    RateLimited: (msg: string = 'Too many attempts. Please try again later.') => new AppError(429, ErrorCode.RATE_LIMITED, msg),
    Internal: (msg: string = 'Internal server error') => new AppError(500, ErrorCode.INTERNAL_ERROR, msg),
};
