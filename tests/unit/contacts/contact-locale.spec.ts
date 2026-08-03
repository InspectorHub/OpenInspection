import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { resolveContactLocale, SUPPORTED_CONTACT_LOCALES } from '../../../server/lib/i18n/contact-locale';

const NONE = { contactLocale: null, linkedUserLocale: null, tenantDefault: null, acceptLanguage: null };

describe('resolveContactLocale', () => {
    it('prefers what the contact told us', () => {
        expect(resolveContactLocale({ ...NONE,
            contactLocale: 'es-MX', linkedUserLocale: 'en-US', tenantDefault: 'en-US',
        })).toBe('es-419');
    });

    it('uses the linked agent user account when the contact has no preference', () => {
        // An agent contact linked to a real user (agent_user_id) has a locale on
        // that user row; a plain client contact has nothing.
        expect(resolveContactLocale({ ...NONE,
            linkedUserLocale: 'es-419', tenantDefault: 'en-US',
        })).toBe('es-419');
    });

    it('falls through an unsupported preference instead of stopping on it', () => {
        expect(resolveContactLocale({ ...NONE,
            contactLocale: 'fr-FR', tenantDefault: 'es-419',
        })).toBe('es-419');
    });

    it('ends at English', () => {
        expect(resolveContactLocale(NONE)).toBe('en');
    });

    it('uses the tenant default before the browser hint', () => {
        expect(resolveContactLocale({ ...NONE,
            tenantDefault: 'en-US', acceptLanguage: 'es-419',
        })).toBe('en');
    });

    it('reads the highest-weighted supported entry out of Accept-Language', () => {
        expect(resolveContactLocale({ ...NONE,
            acceptLanguage: 'fr-FR,es-MX;q=0.9,en;q=0.8',
        })).toBe('es-419');
        // q defaults to 1 and order breaks ties, so a bare list takes the first.
        expect(resolveContactLocale({ ...NONE, acceptLanguage: 'en-GB,es-MX' })).toBe('en');
        expect(resolveContactLocale({ ...NONE, acceptLanguage: '*' })).toBe('en');
    });

    it('treats junk and empty strings as an absence, not as a choice', () => {
        expect(resolveContactLocale({ ...NONE, contactLocale: '', tenantDefault: 'es-419' })).toBe('es-419');
        expect(resolveContactLocale({ ...NONE, contactLocale: 'not a locale!!', tenantDefault: 'es-419' })).toBe('es-419');
    });

    it('matches a region-qualified tag case-insensitively', () => {
        expect(resolveContactLocale({ ...NONE, contactLocale: 'ES-419' })).toBe('es-419');
    });
});

describe('SUPPORTED_CONTACT_LOCALES', () => {
    // server/ cannot import the paraglide runtime (BFF boundary, enforced by
    // no-restricted-imports), so the supported set is restated there. Assert the
    // equality instead of asking a comment to keep it true: resolving to a
    // locale the catalogue has no messages for renders English anyway, silently.
    it('is exactly the set of locales the message catalogue is compiled for', () => {
        const settingsPath = path.resolve(__dirname, '../../../project.inlang/settings.json');
        const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { locales: string[] };
        expect([...SUPPORTED_CONTACT_LOCALES].sort()).toEqual([...settings.locales].sort());
    });
});
