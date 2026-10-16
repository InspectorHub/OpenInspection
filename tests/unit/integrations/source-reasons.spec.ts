/**
 * Every reason a source can be unavailable has a message in both languages, in
 * the product vocabulary, and the helper is the only thing mapping to it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SOURCE_REASONS, INTEGRATION_SERVICES } from '../../../server/lib/integrations/sources';
import { sourceReasonMessageKey } from '../../../server/lib/integrations/source-reasons';

const ROOT = join(__dirname, '../../..');
const load = (lang: string): Record<string, string> =>
    JSON.parse(readFileSync(join(ROOT, 'messages', lang, 'settings-integrations.json'), 'utf8')) as Record<string, string>;
const EN = load('en');
const ES = load('es-419');
const FORBIDDEN = /\b(platform|managed|byo|workspace|tenant|deployment|server)s?\b/i;
const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe('source reason messages', () => {
    const unavailable = SOURCE_REASONS.map((reason) => ({
        reason,
        key: sourceReasonMessageKey({ service: 'email', source: 'unavailable', reason }),
    }));

    it('the six unavailable reasons have a key and the working reasons have none', () => {
        const withKey = unavailable.filter((u) => u.key).map((u) => u.reason).sort();
        expect(withKey).toEqual(['dedicated_not_ready', 'dedicated_unavailable', 'not_offered', 'own_credentials_incomplete', 'provided_not_configured', 'provider_confirmation_pending']);
        expect(unavailable.filter((u) => !u.key).map((u) => u.reason).sort())
            .toEqual(['dedicated_number', 'explicit_choice', 'legacy_setting', 'profile_default']);
    });

    it('a source that resolved is never explained as a problem, whatever the reason (control above: unavailable is)', () => {
        for (const source of ['provided', 'own'] as const) {
            expect(sourceReasonMessageKey({ service: 'sms', source, reason: 'provider_confirmation_pending' })).toBeNull();
        }
        expect(sourceReasonMessageKey({ service: 'sms', source: 'unavailable', reason: 'provider_confirmation_pending' })).not.toBeNull();
    });

    it('every key exists in both languages with the same placeholders', () => {
        for (const { key } of unavailable) {
            if (!key) continue;
            expect(EN[key], `${key} missing in en`).toBeTruthy();
            expect(ES[key], `${key} missing in es-419`).toBeTruthy();
            expect(placeholders(ES[key]!)).toEqual(placeholders(EN[key]!));
        }
    });

    it('no message uses internal vocabulary, and es-419 uses usted and never ajustes', () => {
        for (const lang of [EN, ES]) {
            for (const [k, v] of Object.entries(lang)) {
                if (!k.startsWith('integrations_source_reason_')) continue;
                expect(v, k).not.toMatch(FORBIDDEN);
                expect(v.toLowerCase(), k).not.toContain('ajustes');
                expect(v, k).not.toMatch(/\btu\b|\bti\b|\btus\b/i);
            }
        }
        // control: the detector does flag the words it exists for
        expect('Built-in platform email').toMatch(FORBIDDEN);
    });

    it('the messages name the sources as Built-in and Your own', () => {
        expect(EN.integrations_source_reason_provided_not_configured).toContain('Built-in');
        expect(EN.integrations_source_reason_provided_not_configured).toContain('Your own');
        expect(EN.integrations_source_reason_provider_confirmation_pending).toContain('your own Twilio or Telnyx account');
        expect(EN.integrations_source_reason_provider_confirmation_pending).not.toContain('Built-in');
    });

    it('covers every service the resolver knows (the helper does not special-case one)', () => {
        for (const service of INTEGRATION_SERVICES) {
            expect(sourceReasonMessageKey({ service, source: 'unavailable', reason: 'not_offered' })).not.toBeNull();
        }
    });
});
