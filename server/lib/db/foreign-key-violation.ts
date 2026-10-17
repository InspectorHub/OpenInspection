import type { Context } from 'hono';
import { logger } from '../logger';
import { sendError } from '../response';
import { ErrorCode } from '../errors';

/**
 * True when a driver error (or any error in its `cause` chain) is a FOREIGN KEY constraint failure.
 * Drizzle wraps the driver error, so the original message is on `.cause`. A request that names a row that
 * does not exist should be refused where it is read; this is the net under the routes that forgot, so the
 * caller gets a 400 about their input instead of a 500 about our database.
 */
export function isForeignKeyViolation(err: unknown): boolean {
    for (let e: unknown = err, depth = 0; e instanceof Error && depth < 4; e = e.cause, depth++) {
        if (/FOREIGN KEY constraint failed/i.test(e.message)) return true;
    }
    return false;
}

/**
 * The answer for one: a 400 about the input, with nothing about the row or the statement. Routes check what they
 * read; this answers for the ones that did not.
 */
export function refuseUnknownReference(c: Context): Response {
    logger.warn('Request named a record that does not exist', { method: c.req.method, url: c.req.url.split('?')[0] });
    return sendError(c, 'A referenced record does not exist', ErrorCode.BAD_REQUEST, 400);
}
