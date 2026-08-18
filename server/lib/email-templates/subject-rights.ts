/**
 * The two messages that tell a person their statutory request was honoured.
 *
 * The engine had neither. `subject-export.service.ts` and
 * `erasure-orchestrator.ts` are API-only: they do the work, write the
 * accountability record, and tell nobody. A data subject who asked to be
 * forgotten learned the outcome from the absence of further contact — which is
 * indistinguishable from the request having been ignored.
 *
 * ── Why these are not in the editable template registry ─────────────────────
 * Every other outbound message a tenant can rewrite is a message the TENANT is
 * making. These two report an act performed under statute, and the wording is
 * what makes the report true: an erasure confirmation that dropped the retained
 * categories, or an export notice that dropped the expiry, would still send
 * successfully and would misinform the one person entitled to understand it. So
 * they live here as fixed text with substitution points, not as tenant-editable
 * blocks.
 *
 * ── Why the bodies carry no marketing at all ────────────────────────────────
 * A statutory-rights message that also asks for a review converts a legal
 * obligation into a marketing contact. That is precisely the boundary the
 * category taxonomy exists to hold, and `subject-rights-classes.spec.ts`
 * asserts the absence rather than trusting review to catch it.
 */

export interface SubjectRightsTemplate {
    subject: string;
    /** Fixed text with `{{var}}` substitution points. Not tenant-editable. */
    body: string;
}

/**
 * Keyed by NOTIFICATION CLASS ID, deliberately.
 *
 * The class id is what the send boundary stamps, what the cooling window
 * exempts, and what a preference would key on. Keying the copy by anything else
 * would create a second name for one thing, and the two would drift.
 */
export const SUBJECT_RIGHTS_TEMPLATES: Record<string, SubjectRightsTemplate> = {
    'subject-export-ready': {
        subject: 'Your copy of your data is ready',
        body: [
            'You asked for a copy of the personal data we hold about you on {{requestedAt}}.',
            'It was assembled on {{completedAt}} and is ready to download.',
            '',
            '{{downloadUrl}}',
            '',
            'The link expires on {{expiresAt}}. After that the copy is destroyed and you would',
            'need to ask again — the expiry exists so an unclaimed copy of your data does not',
            'sit on our systems indefinitely.',
            '',
            'If you did not make this request, tell us and we will look into it.',
        ].join('\n'),
    },

    'subject-erasure-confirmed': {
        subject: 'Your erasure request has been completed',
        body: [
            'You asked us to erase the personal data we hold about you on {{requestedAt}}.',
            'That was completed on {{completedAt}}.',
            '',
            'What was kept, and why:',
            '{{retainedSummary}}',
            '',
            // Naming the retained categories is what makes this message true. An
            // erasure that keeps a legally-required record and does not say so
            // reads as a failed erasure to its recipient, and they have no way
            // to tell the difference.
            'Everything else has been deleted or had your identifying details removed.',
            '',
            'If you believe something was missed, tell us and we will look into it.',
        ].join('\n'),
    },
};
