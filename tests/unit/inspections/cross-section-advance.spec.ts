import { describe, it, expect } from 'vitest';

export interface SectionItems { id: string; items: Array<{ id: string }> }

export function findNextUnrated(
    sections: SectionItems[],
    fromSectionId: string,
    fromItemId: string,
    isRated: (sectionId: string, itemId: string) => boolean,
): { sectionId: string; itemId: string; crossedSection: boolean } | null {
    const sIdx = sections.findIndex(s => s.id === fromSectionId);
    if (sIdx < 0) return null;
    const fromItemIdx = sections[sIdx].items.findIndex(it => it.id === fromItemId);
    for (let i = fromItemIdx + 1; i < sections[sIdx].items.length; i++) {
        const it = sections[sIdx].items[i];
        if (!isRated(sections[sIdx].id, it.id)) {
            return { sectionId: sections[sIdx].id, itemId: it.id, crossedSection: false };
        }
    }
    for (let s = sIdx + 1; s < sections.length; s++) {
        for (const it of sections[s].items) {
            if (!isRated(sections[s].id, it.id)) {
                return { sectionId: sections[s].id, itemId: it.id, crossedSection: true };
            }
        }
    }
    return null;
}

describe('findNextUnrated', () => {
    const sections: SectionItems[] = [
        { id: 's1', items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
        { id: 's2', items: [{ id: 'x' }, { id: 'y' }] },
        { id: 's3', items: [{ id: 'p' }] },
    ];

    it('finds next item in same section', () => {
        const ratedSet = new Set(['s1:a']);
        const r = findNextUnrated(sections, 's1', 'a', (sid, iid) => ratedSet.has(`${sid}:${iid}`));
        expect(r).toEqual({ sectionId: 's1', itemId: 'b', crossedSection: false });
    });
    it('crosses into next section when current section is exhausted', () => {
        const ratedSet = new Set(['s1:a', 's1:b', 's1:c']);
        const r = findNextUnrated(sections, 's1', 'c', (sid, iid) => ratedSet.has(`${sid}:${iid}`));
        expect(r).toEqual({ sectionId: 's2', itemId: 'x', crossedSection: true });
    });
    it('skips a fully-rated section to find first unrated in a later section', () => {
        const ratedSet = new Set(['s1:a', 's1:b', 's1:c', 's2:x', 's2:y']);
        const r = findNextUnrated(sections, 's1', 'c', (sid, iid) => ratedSet.has(`${sid}:${iid}`));
        expect(r).toEqual({ sectionId: 's3', itemId: 'p', crossedSection: true });
    });
    it('returns null when nothing is unrated', () => {
        expect(findNextUnrated(sections, 's1', 'a', () => true)).toBeNull();
    });
    it('returns null when fromSectionId is unknown', () => {
        expect(findNextUnrated(sections, 'unknown', 'a', () => false)).toBeNull();
    });
});
