import { describe, it, expect } from 'vitest';
import { convertSpectoraTemplate } from '../../src/lib/spectora-import';

describe('Spectora import — pausesAdvance derivation', () => {
    it('sets pausesAdvance=true when is_defect is true', () => {
        const { template } = convertSpectoraTemplate({
            sections: [],
            rating_levels: [
                { id: 'D', label: 'Defect',  is_defect: true },
                { id: 'S', label: 'Satisfactory',  is_defect: false },
            ],
        });
        const levels = template.ratingSystem!.levels;
        expect(levels.find(l => l.id === 'D')!.pausesAdvance).toBe(true);
        expect(levels.find(l => l.id === 'S')!.pausesAdvance).toBe(false);
    });

    it('treats camelCase isDefect the same as snake_case is_defect', () => {
        const { template } = convertSpectoraTemplate({
            sections: [],
            ratingLevels: [
                { id: 'D', label: 'Defect',  isDefect: true },
            ],
        });
        expect(template.ratingSystem!.levels[0]!.pausesAdvance).toBe(true);
    });

    it('omits pausesAdvance only when neither flag is set', () => {
        const { template } = convertSpectoraTemplate({
            sections: [],
            rating_levels: [
                { id: 'M', label: 'Monitor', is_defect: false },
            ],
        });
        expect(template.ratingSystem!.levels[0]!.pausesAdvance).toBe(false);
    });
});
