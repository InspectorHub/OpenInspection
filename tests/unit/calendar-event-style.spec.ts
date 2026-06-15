import { describe, it, expect } from 'vitest';
import { getCalendarEventStyle } from '../../server/lib/calendar-event-style';

describe('getCalendarEventStyle (iter-2 bug #5)', () => {
    it('renders requested inspections with a DRAFT prefix and lighter color', () => {
        const style = getCalendarEventStyle('requested');
        expect(style.titlePrefix).toBe('DRAFT · ');
        expect(style.isDraft).toBe(true);
        expect(style.color).not.toBe('#6366F1');
    });

    it('renders cancelled inspections with a CANCELLED prefix', () => {
        const style = getCalendarEventStyle('cancelled');
        expect(style.titlePrefix).toBe('CANCELLED · ');
        expect(style.isDraft).toBe(false);
    });

    it('falls back to brand indigo for scheduled/confirmed/completed', () => {
        for (const s of ['scheduled', 'confirmed', 'completed']) {
            const style = getCalendarEventStyle(s);
            expect(style.color).toBe('#6366F1');
            expect(style.titlePrefix).toBe('');
            expect(style.isDraft).toBe(false);
        }
    });

    it('handles null/undefined/empty status defensively', () => {
        for (const s of [null, undefined, '']) {
            const style = getCalendarEventStyle(s);
            expect(style.color).toBe('#6366F1');
            expect(style.titlePrefix).toBe('');
            expect(style.isDraft).toBe(false);
        }
    });

    it('is case-insensitive on status', () => {
        expect(getCalendarEventStyle('REQUESTED').isDraft).toBe(true);
        expect(getCalendarEventStyle('Requested').isDraft).toBe(true);
    });
});
