export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

interface LogContext {
    tenantId?: string;
    userId?: string;
    path?: string;
    method?: string;
    [key: string]: unknown;
}

/**
 * Structured Logger for Cloudflare Workers.
 * Outputs JSON for easy ingestion by log aggregators.
 */
export class Logger {
    constructor(private context: LogContext = {}) {}

    /**
     * Creates a child logger with additional context.
     */
    child(additionalContext: LogContext): Logger {
        return new Logger({ ...this.context, ...additionalContext });
    }

    private log(level: LogLevel, message: string, data?: unknown) {
        const payload = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...this.context,
            ...(data ? { data } : {}),
        };

        // Cloudflare Workers console.log handles objects by stringifying them
        // In production, we want a single line JSON string for aggregators.
        console.info(JSON.stringify(payload));
    }

    debug(message: string, data?: unknown) {
        this.log(LogLevel.DEBUG, message, data);
    }

    info(message: string, data?: unknown) {
        this.log(LogLevel.INFO, message, data);
    }

    warn(message: string, data?: unknown) {
        this.log(LogLevel.WARN, message, data);
    }

    error(message: string, data?: Record<string, unknown>, error?: Error) {
        this.log(LogLevel.ERROR, message, {
            ...(data || {}),
            error: error ? {
                message: error.message,
                stack: error.stack,
            } : undefined,
        });
    }
}

// Default singleton instance
export const logger = new Logger();
