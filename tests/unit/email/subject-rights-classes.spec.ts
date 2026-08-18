/**
 * The two messages that tell a person their statutory request was honoured.
 *
 * The engine had neither. The erasure orchestrator and the subject-export
 * service are API-only: they do the work, write the accountability record, and
 * tell nobody. So a data subject who asked to be forgotten learned the outcome
 * from the absence of further contact.
 *
 * Both are `required`. A person cannot mute the confirmation that their own
 * erasure happened — muting it would mean we performed a statutory act and then
 * honoured a preference that hid it from the only person it concerned.
 *
 * Both are `transactional`, and that is load-bearing rather than a label: the
 * SMS gate and the outbound cooling window both read the category, and a
 * statutory-rights message classified as operational would fall into the
 * 24-hour hold that Task 7 exempts it from.
 */
import { describe, it, expect } from 'vitest';
import { NOTIFICATION_CLASSES, categoryOf } from '../../../server/lib/notifications/classes';
import { SUBJECT_RIGHTS_TEMPLATES } from '../../../server/lib/email-templates/subject-rights';

const IDS = ['subject-export-ready', 'subject-erasure-confirmed'] as const;

describe('statutory-rights notification classes', () => {
    it('the two classes exist, are required, and are transactional', () => {
        for (const id of IDS) {
            const cls = NOTIFICATION_CLASSES.find((c) => c.id === id);
            expect(cls, id).toBeDefined();
            expect(cls!.required, `${id} must not be suppressible`).toBe(true);
            expect(cls!.category).toBe('transactional');
            expect(categoryOf(id)).toBe('transactional');
        }
    });

    it('each is addressed to someone who can actually receive it', () => {
        // A class with an empty audience appears on nobody's screen. These two
        // go to a person who asked us something, so they must name whose screen
        // they belong on — otherwise the preferences page silently omits a
        // notification the reader does receive.
        for (const id of IDS) {
            const cls = NOTIFICATION_CLASSES.find((c) => c.id === id)!;
            expect(cls.audience.length, `${id} has no audience`).toBeGreaterThan(0);
            expect(cls.channels).toContain('email');
        }
    });
});

describe('the bodies say what was done, and sell nothing', () => {
    it('has a template for each class, keyed by the class id', () => {
        for (const id of IDS) {
            expect(SUBJECT_RIGHTS_TEMPLATES[id], `no template for ${id}`).toBeDefined();
            expect(SUBJECT_RIGHTS_TEMPLATES[id]!.subject.length).toBeGreaterThan(0);
        }
    });

    it('carries no marketing content — this is a legal notice, not a touchpoint', () => {
        // A statutory-rights message that reminds someone to leave a review, or
        // links a pricing page, converts a legal obligation into a marketing
        // contact. That is the exact thing the category taxonomy exists to keep
        // apart, so it is asserted here rather than left to review.
        const banned = /unsubscribe|review us|leave a review|upgrade|pricing|discount|offer|newsletter/i;
        for (const id of IDS) {
            const t = SUBJECT_RIGHTS_TEMPLATES[id]!;
            expect(banned.test(t.subject), `${id} subject`).toBe(false);
            expect(banned.test(t.body), `${id} body`).toBe(false);
        }
    });

    it('names WHAT was done and WHEN, because that is the whole content', () => {
        // The message exists to be evidence to its recipient. A body that said
        // only "your request was processed" would be a notification about
        // nothing — it has to carry the act and its date.
        for (const id of IDS) {
            const t = SUBJECT_RIGHTS_TEMPLATES[id]!;
            expect(t.body).toContain('{{requestedAt}}');
            expect(t.body).toContain('{{completedAt}}');
        }
        expect(SUBJECT_RIGHTS_TEMPLATES['subject-erasure-confirmed']!.body).toMatch(/eras|delet/i);
        expect(SUBJECT_RIGHTS_TEMPLATES['subject-export-ready']!.body).toMatch(/copy|export|download/i);
    });

    it('the erasure confirmation states what deliberately survived', () => {
        // An erasure that keeps a legally-required record and does not say so
        // reads as a failed erasure to the one person entitled to understand
        // it. Naming the retained categories is what makes the message true.
        const t = SUBJECT_RIGHTS_TEMPLATES['subject-erasure-confirmed']!;
        expect(t.body).toContain('{{retainedSummary}}');
    });
});
