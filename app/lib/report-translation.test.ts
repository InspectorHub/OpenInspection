import { describe, it, expect } from 'vitest';
import { applyCourtesyTranslation } from './report-translation';

/**
 * The path writer is the only thing standing between a stored translation and a
 * rendered report, so every case below is about it writing EXACTLY where it was
 * told and nowhere else.
 */
const payload = () => ({
    sections: [{
        title: 'Roof',
        disclaimerText: 'This section is limited to what was readily visible.',
        items: [{
            label: 'Roof covering',
            notes: 'Cracked flashing at the ridge.',
            resolvedTabs: {
                limitations: [{ effectiveComment: 'Viewed from the eaves only.' }],
                defects: [{ effectiveComment: 'Displaced flashing.' }],
            },
        }],
    }],
    relianceText: { userReliance: 'This report is for the named user only.' },
});

describe('applyCourtesyTranslation', () => {
    it('writes each segment at its own path', () => {
        const { payload: out, applied, skipped } = applyCourtesyTranslation(payload(), {
            paths: ['sections.0.title', 'sections.0.items.0.notes'],
            segments: ['Techo', 'Tapajuntas agrietado en la cumbrera.'],
        });
        expect(applied).toBe(2);
        expect(skipped).toBe(0);
        expect(out.sections[0]!.title).toBe('Techo');
        expect(out.sections[0]!.items[0]!.notes).toBe('Tapajuntas agrietado en la cumbrera.');
    });

    it('leaves everything it was not given alone', () => {
        // The reliance block and the per-section disclaimer stay English
        // because no segment was produced for them — not because this function
        // recognises them. Asserted here so a future "helpful" path expansion
        // has to walk past it.
        const { payload: out } = applyCourtesyTranslation(payload(), {
            paths: ['sections.0.title'],
            segments: ['Techo'],
        });
        expect(out.sections[0]!.disclaimerText)
            .toBe('This section is limited to what was readily visible.');
        expect(out.relianceText.userReliance).toBe('This report is for the named user only.');
        expect(out.sections[0]!.items[0]!.resolvedTabs.limitations[0]!.effectiveComment)
            .toBe('Viewed from the eaves only.');
    });

    it('does not mutate the payload it was handed', () => {
        const original = payload();
        applyCourtesyTranslation(original, {
            paths: ['sections.0.title'], segments: ['Techo'],
        });
        expect(original.sections[0]!.title).toBe('Roof');
    });

    it('REFUSES a mismatched pair rather than writing what it can', () => {
        // Segments are positional. A mismatched pair maps translated prose onto
        // the wrong components, and the result reads like a correct report
        // about the wrong house.
        const { payload: out, applied } = applyCourtesyTranslation(payload(), {
            paths: ['sections.0.title', 'sections.0.items.0.notes'],
            segments: ['Techo'],
        });
        expect(applied).toBe(0);
        expect(out.sections[0]!.title).toBe('Roof');
    });

    it('counts a path that no longer resolves instead of throwing', () => {
        // The payload shape moved under a stored translation. That span stays
        // English, which is the honest outcome — not an error on a client's
        // report page, and not a value written somewhere adjacent.
        const { payload: out, applied, skipped } = applyCourtesyTranslation(payload(), {
            paths: ['sections.9.title', 'sections.0.title'],
            segments: ['Nada', 'Techo'],
        });
        expect(applied).toBe(1);
        expect(skipped).toBe(1);
        expect(out.sections[0]!.title).toBe('Techo');
    });

    it('never CREATES a key the payload did not carry', () => {
        const { payload: out, skipped } = applyCourtesyTranslation(payload(), {
            paths: ['sections.0.invented'], segments: ['Inventado'],
        });
        expect(skipped).toBe(1);
        expect((out.sections[0] as Record<string, unknown>).invented).toBeUndefined();
    });

    it('returns the payload untouched when there is no translation', () => {
        const { payload: out, applied } = applyCourtesyTranslation(payload(), null);
        expect(applied).toBe(0);
        expect(out.sections[0]!.title).toBe('Roof');
    });
});
