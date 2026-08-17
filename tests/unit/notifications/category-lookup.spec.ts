/**
 * `categoryOf` — what a notification IS, asked from outside this module.
 *
 * The category is the compliance taxonomy: transactional, operational,
 * marketing. It was declared without `export` and had no accessor, so the SMS
 * send gate could not ask the one question that decides whether a message may
 * ride a transactional consent.
 *
 * UNDEFINED IS NOT 'transactional', and that is the whole point of returning it
 * rather than a default. A caller that cannot identify a class has to decide
 * for itself what an unknown means, and on the SMS path it means block — a
 * default here would make every unknown id silently sendable.
 */
import { describe, it, expect } from 'vitest';
import { categoryOf, NOTIFICATION_CLASSES } from '../../../server/lib/notifications/classes';

describe('categoryOf', () => {
    it('finds the one marketing class', () => {
        expect(categoryOf('review-request')).toBe('marketing');
    });

    it('reports transactional and operational faithfully', () => {
        expect(categoryOf('booking-confirmation')).toBe('transactional');
        expect(categoryOf('admin-test-send')).toBe('operational');
    });

    it('returns undefined for an unknown id rather than guessing', () => {
        expect(categoryOf('no-such-class')).toBeUndefined();
    });

    it('answers for EVERY class in the vocabulary', () => {
        // A lookup that worked for the three ids someone happened to test and
        // returned undefined for the rest would pass everything above. The
        // caller treats undefined as "block", so a hole here is a message that
        // silently stops sending.
        const unanswered = NOTIFICATION_CLASSES
            .filter((c) => categoryOf(c.id) === undefined)
            .map((c) => c.id);
        expect(unanswered).toEqual([]);
        expect(NOTIFICATION_CLASSES.length).toBeGreaterThan(20);
    });

    it('never invents a category outside the taxonomy', () => {
        const allowed = new Set(['transactional', 'operational', 'marketing']);
        for (const c of NOTIFICATION_CLASSES) {
            expect(allowed.has(categoryOf(c.id)!), `${c.id} -> ${categoryOf(c.id)}`).toBe(true);
        }
    });
});
