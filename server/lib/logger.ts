enum LogLevel {
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
class Logger {
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
        // The console method sets the NATIVE level in Workers Logs, so an ERROR
        // must go through console.error or anything filtering on that level
        // (alert rules included) sees it as info.
        const line = JSON.stringify(payload);
        if (level === LogLevel.ERROR) console.error(line);
        else if (level === LogLevel.WARN) console.warn(line);
        else console.info(line);
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

    /**
     * An ERROR that needs a human. The `[alert:<code>]` prefix is part of the
     * message on purpose: Workers Logs alert rules can match message text but
     * not the `data` object, so the code has to live in the message. Use it only
     * for conditions that call for action, never for expected traffic.
     */
    alert(code: string, message: string, data?: Record<string, unknown>, error?: Error) {
        this.error(`[alert:${code}] ${message}`, data, error);
    }
}

// Default singleton instance
export const logger = new Logger();
