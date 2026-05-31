import { describe, it, expect } from 'vitest';
import { DEFAULT_AUTO_SEED_NAMES, TemplateSeedService } from '../../server/services/template-seed.service';

describe('TemplateSeedService', () => {
    it('exposes bulkSeed', () => {
        const svc = new TemplateSeedService({} as never);
        expect(typeof svc.bulkSeed).toBe('function');
    });

    it('DEFAULT_AUTO_SEED_NAMES contains exactly 7 entries', () => {
        expect(DEFAULT_AUTO_SEED_NAMES).toHaveLength(7);
    });

    it('DEFAULT_AUTO_SEED_NAMES has stable seed names', () => {
        expect(DEFAULT_AUTO_SEED_NAMES).toEqual(expect.arrayContaining([
            'Standard Residential Inspection',
            'Pre-Listing Inspection',
            'New Construction Pre-Drywall Inspection',
            'New Construction Final Walkthrough',
            'Sewer Scope Inspection',
            'Radon Measurement Report',
            'Mold Inspection',
        ]));
    });
});
