import { AppError, ErrorCode, Errors } from '../errors';
import { logger } from '../logger';
import type { EmailProvider } from './provider';

type Failure = Extract<Awaited<ReturnType<EmailProvider['sendEmail']>>, { ok: false }>;

/**
 * Turn a provider failure that needs no side effect into the error callers see.
 * (A suppressed recipient is handled by the sender itself because it writes
 * back to the suppression table first.)
 *
 * - quota_exceeded: 402. `details.quotaWindow` says daily or monthly when the
 *   adapter knew, so a caller that can wait for the reset tells them apart.
 * - rate_limited:   429 with a plain "try again shortly" message.
 * - sender_domain:  the operator-facing domain error.
 * - anything else:  the generic delivery failure.
 */
export function providerFailureError(failure: Failure): AppError {
    const { error, kind } = failure;
    if (kind === 'quota_exceeded') {
        logger.error('[email] Provider quota exceeded', { error, quotaWindow: failure.quotaWindow });
        return new AppError(402, ErrorCode.QUOTA_EXHAUSTED,
            'Your email sending quota is exhausted. Upgrade your plan or wait for the quota to reset.',
            {
                metric: 'email', used: 0, cap: 0, billingPortalUrl: null,
                ...(failure.quotaWindow ? { quotaWindow: failure.quotaWindow } : {}),
            },
        );
    }
    if (kind === 'rate_limited') {
        logger.warn('[email] Provider rate limit persisted after the inline retry', { retryAfterSeconds: failure.retryAfterSeconds });
        return Errors.EmailRateLimited(failure.retryAfterSeconds);
    }
    if (kind === 'sender_domain') {
        logger.error('[email] Sender domain error', { error });
        return Errors.EmailSenderDomain({ hint: error });
    }
    logger.error('[email] Delivery failed', { kind, error });
    return new AppError(502, ErrorCode.SERVICE_UNAVAILABLE, 'Email delivery failed. Please try again.');
}
