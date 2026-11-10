import { AppError, ErrorCode, Errors } from '../../lib/errors';

/** What a visitor who is not on the company's staff (a booking client, a referring agent) is told when the company's
 *  monthly inspection allowance is spent. It names no plan, limit or price: they set nothing up and have nothing to act
 *  on, so the answer is a plain "not available right now". */
export const NEUTRAL_BOOKING_REFUSAL =
    'This company is not taking new online bookings right now. Please contact them directly to arrange your inspection.';

/** The neutral refusal for a spent inspection allowance, or null when `err` is anything else (rethrow it as it is). */
export function neutralBookingRefusal(err: unknown): AppError | null {
    if (!(err instanceof AppError) || err.code !== ErrorCode.QUOTA_EXHAUSTED) return null;
    const details = typeof err.details === 'object' && err.details !== null ? err.details as { metric?: unknown } : {};
    return details.metric === 'inspections' ? Errors.Conflict(NEUTRAL_BOOKING_REFUSAL) : null;
}
