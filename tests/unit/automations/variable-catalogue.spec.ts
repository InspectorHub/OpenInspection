import { describe, it, expect } from 'vitest';
import {
    AUTOMATION_VARIABLES, AUTOMATION_VARIABLE_SAMPLES, previewVariables,
} from '../../../server/services/automation/variable-catalogue';
import { AUTOMATION_SEEDS } from '../../../server/data/automation-seeds';
import { buildBaseTemplateVars } from '../../../server/services/automation/template-vars';
import { extractVars } from '../../../server/services/message-template-backfill';

describe('automation variable catalogue', () => {
    it('has a non-empty sample for every catalogued variable and no extras', () => {
        expect(Object.keys(AUTOMATION_VARIABLE_SAMPLES).sort()).toEqual([...AUTOMATION_VARIABLES].sort());
        for (const name of AUTOMATION_VARIABLES) {
            expect(AUTOMATION_VARIABLE_SAMPLES[name].trim(), name).not.toBe('');
        }
    });

    it('uses only reserved example domains and fictional phone numbers', () => {
        for (const value of Object.values(AUTOMATION_VARIABLE_SAMPLES)) {
            for (const host of value.matchAll(/https?:\/\/([^/\s]+)/g)) {
                expect(host[1]).toMatch(/\.test$/);
            }
        }
        expect(AUTOMATION_VARIABLE_SAMPLES.company_phone).toContain('555');
    });

    it('covers every token the seeded templates use', () => {
        const used = new Set<string>();
        for (const seed of AUTOMATION_SEEDS) {
            for (const v of extractVars(
                seed.subjectTemplate, seed.bodyTemplate, 'smsBody' in seed ? seed.smsBody : null,
                'inAppTitle' in seed ? seed.inAppTitle : null, 'inAppBody' in seed ? seed.inAppBody : null,
            )) used.add(v);
        }
        expect(used.size).toBeGreaterThan(0);
        for (const v of used) expect(AUTOMATION_VARIABLES as readonly string[], v).toContain(v);
    });

    it('covers every variable the shared delivery builder produces', () => {
        const vars = buildBaseTemplateVars(
            { id: 'i', tenantId: 't', propertyAddress: 'a', date: '2026-06-01', status: 'scheduled',
              reportStatus: 'in_progress', paymentStatus: 'unpaid', clientContactId: null, clientName: null },
            { slug: 'acme' } as never, 'Acme', 'app.example.test',
            { locale: 'en-US', timeZone: 'UTC' } as never,
        );
        for (const key of Object.keys(vars)) expect(AUTOMATION_VARIABLES as readonly string[], key).toContain(key);
    });

    it('lets a caller override a sample and keeps the rest', () => {
        const vars = previewVariables({ client_name: 'Override' });
        expect(vars.client_name).toBe('Override');
        expect(vars.company_name).toBe(AUTOMATION_VARIABLE_SAMPLES.company_name);
    });
});
