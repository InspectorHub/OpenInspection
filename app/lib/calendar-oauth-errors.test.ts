import { describe, it, expect } from 'vitest';
import { calendarOAuthErrorToast } from './calendar-oauth-errors';

describe('calendarOAuthErrorToast', () => {
    it('maps access_denied to a neutral cancellation message', () => {
        const t = calendarOAuthErrorToast('access_denied');
        expect(t.variant).toBe('neutral');
        expect(t.message).toContain('cancelled');
        expect(t.message).not.toContain('access_denied');
    });

    it('maps unknown codes to a generic error without leaking the code', () => {
        const t = calendarOAuthErrorToast('some_internal_code');
        expect(t.variant).toBe('error');
        expect(t.message).not.toContain('some_internal_code');
    });
});
