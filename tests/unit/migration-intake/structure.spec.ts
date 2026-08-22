/**
 * What the conversion actually produced, as the preview step reads it.
 *
 * ── Why the report needs this at all ────────────────────────────────────────
 * The import step prints four numbers and they always add up. They cannot tell
 * a good conversion from a useless one: a template whose seventy-six items all
 * became plain text boxes reports the same total, the same "ready" count and
 * the same zero problems as one that converted perfectly. This is the shape
 * that difference is visible in.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 * It does not judge. The four anomaly criteria live on the screen that shows
 * them, because they are about what a person should look at; this builds the
 * facts they are computed from, and it names every entry the conversion could
 * not carry rather than counting them.
 */
import { describe, it, expect } from 'vitest';
import { buildBatchStructure } from '../../../server/services/migration-intake/structure';
import type { BundleTemplate } from '../../../server/lib/migration-intake/bundle';
import type { TemplateItem } from '../../../server/types/template-schema';

function item(over: Partial<TemplateItem> = {}): TemplateItem {
    return {
        id: 'i1',
        label: 'Covering',
        type: 'rich',
        ratingOptions: ['Satisfactory'],
        tabs: { information: [], limitations: [], defects: [] },
        ...over,
    } as TemplateItem;
}

function template(sections: { title: string; items: TemplateItem[] }[]): BundleTemplate {
    return {
        name: 'AHIT Master',
        schema: {
            schemaVersion: 2,
            sections: sections.map((s, i) => ({ id: `s${i}`, title: s.title, items: s.items })),
        },
        stats: {
            sections: sections.length,
            items: sections.reduce((n, s) => n + s.items.length, 0),
            information: 0, limitations: 0, defects: 0, unknownCommentTypes: [],
        },
    };
}

const NO_DROPS = { readFromSource: 1, emitted: 1, dropped: [] };

describe('buildBatchStructure', () => {
    it('is null for a run carrying no template at all', () => {
        // Contacts have no shape to judge — the repair table IS a row-by-row
        // preview of them — so the step has to be absent rather than empty.
        expect(buildBatchStructure([], NO_DROPS, [])).toBeNull();
    });

    it('carries the template\'s own sections and items, in order', () => {
        const got = buildBatchStructure([template([
            { title: 'Roof', items: [item({ label: 'Covering' }), item({ label: 'Flashing' })] },
            { title: 'Attic', items: [] },
        ])], NO_DROPS, []);
        expect(got?.name).toBe('AHIT Master');
        expect(got?.sections.map((s) => s.title)).toEqual(['Roof', 'Attic']);
        expect(got?.sections[0]?.items.map((i) => i.label)).toEqual(['Covering', 'Flashing']);
    });

    it('says how each item LANDED, without naming our storage for it', () => {
        const got = buildBatchStructure([template([{
            title: 'Roof',
            items: [
                item({ label: 'Rated' }),
                item({ label: 'Chosen', type: 'select', ratingOptions: undefined, tabs: undefined }),
                item({ label: 'Typed', type: 'textarea', ratingOptions: undefined, tabs: undefined }),
                item({ label: 'Also typed', type: 'text', ratingOptions: undefined, tabs: undefined }),
            ],
        }])], NO_DROPS, []);
        expect(got?.sections[0]?.items.map((i) => i.landedAs))
            .toEqual(['rated', 'choices', 'plain', 'plain']);
    });

    it('gives DIFFERENT answers for different item shapes — the comparison', () => {
        // Each reading above would be satisfied by a builder that answered the
        // same way for everything. Three distinct answers cannot be.
        const got = buildBatchStructure([template([{
            title: 'Roof',
            items: [
                item(),
                item({ type: 'select', ratingOptions: undefined, tabs: undefined }),
                item({ type: 'photo_only', ratingOptions: undefined, tabs: undefined }),
            ],
        }])], NO_DROPS, []);
        expect(new Set(got?.sections[0]?.items.map((i) => i.landedAs)).size).toBe(3);
    });

    it('NAMES every entry the conversion could not carry', () => {
        // A count tells the operator something is missing without telling them
        // what, and the thing they need is the name — it is how they find it in
        // their own file.
        const got = buildBatchStructure([template([{ title: 'Roof', items: [item()] }])], {
            readFromSource: 3,
            emitted: 1,
            dropped: [
                { at: 'row 42', reason: 'Executive Summary has no item' },
                { at: 'row 91', reason: 'Blank row' },
            ],
        }, []);
        expect(got?.dropped.map((d) => d.reason))
            .toEqual(['Executive Summary has no item', 'Blank row']);
        expect(got?.dropped.map((d) => d.at)).toEqual(['row 42', 'row 91']);
    });

    it('reports an empty list of drops rather than omitting it', () => {
        // An absent list and an empty one look identical on a screen, and the
        // empty one is the information: nothing was skipped.
        const got = buildBatchStructure([template([{ title: 'Roof', items: [item()] }])], NO_DROPS, []);
        expect(got?.dropped).toEqual([]);
    });

    it('carries the manifest WARNINGS, which are the only per-comment record', () => {
        // `counts.template` accounts in whole templates — one read, one
        // emitted — so an untyped comment filed under Information can never
        // appear in `dropped` however many there were. The warnings are the
        // only place that decision is written down, and a preview that read
        // `dropped` alone would report a clean conversion of a file whose
        // comments were all filed under a heading nobody chose.
        const got = buildBatchStructure(
            [template([{ title: 'Roof', items: [item()] }])],
            NO_DROPS,
            [{ code: 'UNTYPED_COMMENTS', message: '3 comments said "summary"' }],
        );
        expect(got?.warnings).toEqual([
            { code: 'UNTYPED_COMMENTS', message: '3 comments said "summary"' },
        ]);
        // And they are NOT folded into the losses: one came across, the other
        // did not, and a single list would have to describe both wrongly.
        expect(got?.dropped).toEqual([]);
    });

    it('reports an empty list of warnings rather than omitting it', () => {
        const got = buildBatchStructure(
            [template([{ title: 'Roof', items: [item()] }])], NO_DROPS, [],
        );
        expect(got?.warnings).toEqual([]);
    });

    it('reads the FIRST template when a run somehow carries several', () => {
        // An overwrite accepts exactly one and the server refuses more, so this
        // is the shape a delivered bundle could arrive in — a preview of the
        // first is better than a preview of none.
        const got = buildBatchStructure(
            [template([{ title: 'One', items: [] }]), template([{ title: 'Two', items: [] }])],
            NO_DROPS,
            [],
        );
        expect(got?.sections.map((s) => s.title)).toEqual(['One']);
    });
});
