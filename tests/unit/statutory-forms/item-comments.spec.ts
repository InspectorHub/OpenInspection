import { describe, it, expect } from 'vitest';
import { composeItemComments } from '../../../server/lib/statutory/item-comments';

/**
 * What one section's Comments box says.
 *
 * -- WHAT THESE ASSERT -------------------------------------------------------
 * Not the wording. The wording is the inspector's. What is checkable is that
 * the composition agrees with the REPORT's rules, because the alternative is
 * one finding reading two different ways on two documents produced from the
 * same inspection under the same signature.
 */
const TABS = {
    information: [
        { id: 'i1', comment: 'Roof was inspected from the ground.', default: true },
        { id: 'i2', comment: 'Attic was entered.', default: false },
    ],
    limitations: [
        { id: 'l1', comment: 'Snow limited the view.', default: false },
    ],
    defects: [
        {
            id: 'd1', title: 'Cracked tile', category: 'safety', location: 'north slope',
            comment: 'Cracked tile at {{location}}.', photos: [], default: false,
        },
    ],
};

describe('composeItemComments', () => {
    it('includes what defaults say when the inspector touched nothing', () => {
        expect(composeItemComments(TABS, undefined, undefined, undefined))
            .toBe('Roof was inspected from the ground.');
    });

    it('lets a state row turn a default OFF', () => {
        // The positive control for the assertion above: a composer that ignored
        // state would satisfy that one perfectly.
        expect(composeItemComments(
            TABS, { information: [{ cannedId: 'i1', included: false }] }, undefined, undefined,
        )).toBe('');
    });

    it('orders information, then limitations, then defects, then notes', () => {
        const out = composeItemComments(
            TABS,
            {
                information: [{ cannedId: 'i2', included: true }],
                limitations: [{ cannedId: 'l1', included: true }],
                defects:     [{ cannedId: 'd1', included: true }],
            },
            'Recommend a roofer.',
            undefined,
        );
        // Joined by a space, because a hard break costs a whole line and these
        // boxes are small -- see the composer's header. The ORDER is what this
        // asserts; the separator is asserted on its own below.
        expect(out).toBe([
            'Roof was inspected from the ground.',
            'Attic was entered.',
            'Snow limited the view.',
            'Cracked tile at north slope.',
            'Recommend a roofer.',
        ].join(' '));
        expect(out).not.toContain('\n');
    });

    it('renders a defect\'s Mustache variables, as the report does', () => {
        // `{{location}}` unresolved would PRINT the braces on an authority's form.
        const out = composeItemComments(
            TABS, { defects: [{ cannedId: 'd1', included: true }] }, undefined, undefined,
        );
        // `i1` is a default, so it is there too -- that is the point of the
        // previous assertions and not what this one is about.
        expect(out.endsWith('Cracked tile at north slope.')).toBe(true);
        expect(out).not.toContain('{{');
    });

    it('prefers a non-empty state comment over the canned one', () => {
        expect(composeItemComments(
            TABS,
            { information: [{ cannedId: 'i1', included: true, comment: 'Walked the roof.' }] },
            undefined, undefined,
        )).toBe('Walked the roof.');
    });

    it('treats an EMPTY state comment as a cleared box, not a request for the canned text', () => {
        // Clearing the box and asking for the default back are different acts,
        // and only one of them is what an empty string looks like.
        expect(composeItemComments(
            TABS, { information: [{ cannedId: 'i1', included: true, comment: '' }] },
            undefined, undefined,
        )).toBe('Roof was inspected from the ground.');
    });

    it('composes an item nobody answered to EMPTY, never to a missing value', () => {
        // `values.ts` refuses on an ABSENT key for a required field. An item the
        // inspector has not reached yet must not trip that refusal.
        expect(composeItemComments(undefined, undefined, undefined, undefined)).toBe('');
        expect(composeItemComments({ information: [] }, {}, '', {})).toBe('');
    });

    it('does not trim, because a leading space may be somebody\'s typesetting', () => {
        expect(composeItemComments(undefined, undefined, '  spaced  ', undefined))
            .toBe('  spaced  ');
    });
});
