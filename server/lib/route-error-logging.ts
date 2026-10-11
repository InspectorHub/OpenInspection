import { isRouteErrorResponse } from 'react-router';
import { logger } from './logger';

/**
 * React Router's default handleError console.errors EVERY error it sees, a 404
 * for an unmatched route or a 405 for a POST to a page included. Internet
 * scanners probe paths that do not exist all day, so those expected 4xx answers
 * filled Workers Logs with `error` stack traces and made an error-level alert
 * useless.
 *
 * Only a genuine failure is worth an error line: a 5xx, or something thrown that
 * is not a response at all. A client that already hung up is not a failure.
 */
export function shouldLogRouteError(error: unknown, request: Request): boolean {
  if (request.signal.aborted) return false;
  if (isRouteErrorResponse(error)) return error.status >= 500;
  if (error instanceof Response) return error.status >= 500;
  return true;
}

export function logRouteError(error: unknown, request: Request): void {
  if (!shouldLogRouteError(error, request)) return;
  // Path only: a query string can carry one-shot secrets such as a reset token.
  const path = new URL(request.url).pathname;
  logger.error('Unhandled route error', { method: request.method, path }, error instanceof Error ? error : undefined);
}
