import { describe, it, expect } from 'vitest';
import { getCalendarEventStyle } from '../../server/lib/calendar-event-style';

describe('getCalendarEventStyle (iter-2 bug #5)', () => {
    it('renders draft inspections with a DRAFT prefix and lighter color', () => {
        const style = getCalendarEventStyle('draft');
        expect(style.titlePrefix).toBe('DRAFT · ');
        expect(style.isDraft).toBe(true);
        expect(style.color).not.toBe('#6366F1');
    });

    it('renders cancelled inspections with a CANCELLED prefix', () => {
        const style = getCalendarEventStyle('cancelled');
        expect(style.titlePrefix).toBe('CANCELLED · ');
        expect(style.isDraft).toBe(false);
    });

    it('falls back to brand indigo for confirmed/scheduled/in_progress', () => {
        for (const s of ['scheduled', 'confirmed', 'in_progress', 'completed', 'delivered']) {
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
        expect(getCalendarEventStyle('DRAFT').isDraft).toBe(true);
        expect(getCalendarEventStyle('Draft').isDraft).toBe(true);
    });
});
