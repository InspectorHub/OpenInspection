import { describe, it, expect } from 'vitest';
import { convertSpectoraTemplate, type SpectoraTemplate } from '../../src/lib/spectora-import';
import { TemplateSchemaV2Schema } from '../../src/lib/validations/template.schema';

const SAMPLE_SPECTORA: SpectoraTemplate = {
    id: 'spectora_tpl_42',
    name: 'Commercial Inspection 2024',
    sections: [
        {
            id: 'sec_roof',
            name: 'Roof',
            identifier: '4.0',
            items: [
                {
                    id: 'item_roof_cover',
                    name: 'Roof Covering',
                    comments: [
                        { id: 'c1', type: 'INFORMATIONAL', title: 'Material', text: 'Asphalt composition shingles observed.', default: true },
                        { id: 'c2', type: 'SATISFACTORY', text: 'No active leaks at the time of inspection.' },
                        { id: 'c3', type: 'MONITOR', title: 'Granule loss', text: 'Mild granule loss; monitor and plan for replacement within 3-5 years.' },
                        { id: 'c4', type: 'DEFECT', title: 'Missing shingles', text: 'Several shingles missing at the southeast corner; recommend repair by a qualified roofer.', location: 'Southeast corner' },
                    ],
                },
                {
                    id: 'item_flashings',
                    name: 'Flashings',
                    comments: [
                        { id: 'c5', type: 'INFORMATIONAL', text: 'Galvanised steel flashings observed.' },
                    ],
                },
            ],
        },
        {
            id: 'sec_plumbing',
            name: 'Plumbing',
            items: [
                {
                    id: 'item_water_heater',
                    name: 'Water Heater',
                    comments: [
                        // Intentionally unknown bucket — should land under information with the kind preserved in the title.
                        { id: 'c6', type: 'NOTE_FOR_BUILDER', text: 'Builder confirmed unit was installed in 2022.' },
                    ],
                },
            ],
        },
    ],
};

describe('convertSpectoraTemplate', () => {
    const { template, stats } = convertSpectoraTemplate(SAMPLE_SPECTORA);

    it('produces a structurally valid v2 schema', () => {
        const parsed = TemplateSchemaV2Schema.safeParse(template);
        if (!parsed.success) {
            // Surface the Zod issues in the failure message — easier to debug than just "false".
            throw new Error('Output did not validate against TemplateSchemaV2Schema: ' + JSON.stringify(parsed.error.issues, null, 2));
        }
        expect(parsed.success).toBe(true);
    });

    it('maps 4 Spectora comment buckets to 3 v2 tabs', () => {
        const roof = template.sections[0]!;
        const cover = roof.items[0]!;
        expect(cover.tabs?.information).toHaveLength(2);  // INFORMATIONAL + SATISFACTORY (prefixed)
        expect(cover.tabs?.defects).toHaveLength(2);      // MONITOR + DEFECT
        expect(cover.tabs?.limitations).toHaveLength(0);  // Spectora has no direct limitations equivalent

        const monitor = cover.tabs!.defects[0]!;
        expect(monitor.category).toBe('recommendation');
        const defect = cover.tabs!.defects[1]!;
        expect(defect.category).toBe('safety');
        expect(defect.location).toBe('Southeast corner');
    });

    it('prefixes SATISFACTORY comments so they survive the 3-tab collapse', () => {
        const cover = template.sections[0]!.items[0]!;
        const titles = cover.tabs!.information.map(c => c.title);
        expect(titles).toContain('Material');
        expect(titles.some(t => t.startsWith('Satisfactory · '))).toBe(true);
    });

    it('routes unknown comment kinds to information without losing the source kind', () => {
        const heater = template.sections[1]!.items[0]!;
        expect(heater.tabs?.information).toHaveLength(1);
        expect(heater.tabs!.information[0]!.title).toMatch(/^NOTE_FOR_BUILDER/);
        expect(stats.unknownCommentTypes).toContain('NOTE_FOR_BUILDER');
    });

    it('preserves Spectora identifiers via the v2 source field on each level', () => {
        const roof = template.sections[0]!;
        expect(roof.source).toEqual({ platform: 'spectora', externalId: 'sec_roof' });
        expect(roof.identifier).toBe('4.0');

        const cover = roof.items[0]!;
        expect(cover.source).toEqual({ platform: 'spectora', externalId: 'item_roof_cover' });
    });

    it('counts mapped entries for diff display', () => {
        expect(stats.sections).toBe(2);
        expect(stats.items).toBe(3);
        expect(stats.information + stats.defects + stats.limitations).toBe(6);
        expect(stats.unknownCommentTypes).toEqual(['NOTE_FOR_BUILDER']);
    });
});
