import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { leadingOutlineToken, outlineNumbers } from '../../../server/lib/template-hierarchy';

/**
 * F53 — a statutory template's own letters must not be doubled by the editor's
 * derived outline badge.
 *
 * The TREC form prints `A. Foundations`, `B. Grading and Drainage`, … and that
 * wording is the authority's, not ours to edit, so the letter lives in the item
 * LABEL. The editor then printed its own derived `A` beside it, and every row of
 * the installed template read `AA. Foundations`, `BB. Grading and Drainage` — 41
 * rows on one official form.
 *
 * ⚠️ ASSERTED AGAINST THE INSTALLED TEMPLATE, not against the generator. A spec
 * that invented three labels beginning `A. `/`B. `/`C. ` would pass while the
 * shipped seed template carried a shape it had never been shown: six sections,
 * each restarting at A, and one label (`I. Stairways`) whose letter is also a
 * Roman numeral. The fixture is read off disk for that reason.
 */
const TREC = join(process.cwd(), 'server', 'data', 'seed-templates', 'trec-rei-7-6.json');

interface SeedItem { id?: string; label?: string; parentId?: string | null }
interface SeedSection { id?: string; title?: string; items?: SeedItem[] }

function trecSections(): SeedSection[] {
    const doc = JSON.parse(readFileSync(TREC, 'utf8')) as { schema?: { sections?: SeedSection[] } };
    return doc.schema?.sections ?? [];
}

describe('the TREC seed template, as the editor numbers it', () => {
    const sections = trecSections();

    it('CONTROL — the fixture really is the 41-item, letter-prefixed form', () => {
        // Without this, every assertion below could be satisfied by an empty
        // read: zero items produce zero duplicate prefixes.
        const items = sections.flatMap((s) => s.items ?? []);
        expect(sections.length).toBe(6);
        expect(items.length).toBe(41);
        expect(items.every((i) => leadingOutlineToken(i.label) !== null)).toBe(true);
    });

    it('prints no badge where the label already carries that exact letter', () => {
        const doubled: string[] = [];
        for (const section of sections) {
            const items = (section.items ?? []).map((i) => ({
                id: String(i.id ?? ''),
                label: String(i.label ?? ''),
                ...(i.parentId === undefined ? {} : { parentId: i.parentId }),
            }));
            const outlines = outlineNumbers(items);
            for (const item of items) {
                const badge = outlines.get(item.id) ?? '';
                // The defect, stated as the reader saw it: badge + label begins
                // with the same letter twice.
                if (badge !== '' && item.label.startsWith(badge)) {
                    doubled.push(`${badge}${item.label}`);
                }
            }
        }
        expect(doubled).toEqual([]);
    });

    it('still numbers an ordinary template, whose labels carry no letters', () => {
        // The assertion that stops the fix from being "hide every badge". An
        // ordinary residential template keeps its outline, which is what makes
        // the column survive the 280px truncation it exists for.
        const plain = [{ id: 'x', label: 'Foundations' }, { id: 'y', label: 'Roof' }];
        expect(outlineNumbers(plain)).toEqual(new Map([['x', 'A'], ['y', 'B']]));
    });

    it('keeps BOTH when the label\'s own numbering disagrees with its position', () => {
        // A label that prints `C.` in first position is saying something the
        // derived number does not, and that disagreement is the case worth
        // seeing. Suppression is conditional on equality for this reason.
        const odd = [{ id: 'x', label: 'C. Roof Covering' }, { id: 'y', label: 'D. Grading' }];
        expect(outlineNumbers(odd)).toEqual(new Map([['x', 'A'], ['y', 'B']]));
    });
});

describe('leadingOutlineToken', () => {
    it('reads the enumerator a label prints for itself', () => {
        expect(leadingOutlineToken('A. Foundations')).toBe('A');
        expect(leadingOutlineToken('I. Stairways (Interior and Exterior)')).toBe('I');
        expect(leadingOutlineToken('12) Panel')).toBe('12');
        expect(leadingOutlineToken('AA. Other')).toBe('AA');
    });

    it('reads nothing where there is nothing to read', () => {
        expect(leadingOutlineToken('Foundations')).toBeNull();
        // No separator, no token: a sentence starting with a capital is not an
        // enumerator, and treating it as one would blank a legitimate badge.
        expect(leadingOutlineToken('A Foundations')).toBeNull();
        expect(leadingOutlineToken('Roof.Covering')).toBeNull();
        expect(leadingOutlineToken(undefined)).toBeNull();
    });
});
