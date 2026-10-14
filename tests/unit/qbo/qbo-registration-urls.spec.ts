import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    qboRegistrationUrls,
    qboRedirectUri,
    QBO_CALLBACK_PATH,
    QBO_DISCONNECT_PAGE_PATH,
    QBO_WEBHOOK_PATH,
} from '../../../server/lib/qbo-oauth-paths';

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

describe('qboRegistrationUrls', () => {
    it('builds all three addresses from one origin, the redirect URI through qboRedirectUri', () => {
        const urls = qboRegistrationUrls('https://dev.example.com');
        expect(urls.redirectUri).toBe(qboRedirectUri('https://dev.example.com'));
        expect(urls.redirectUri).toBe('https://dev.example.com/api/integrations/qbo/callback');
        expect(urls.disconnectUrl).toBe('https://dev.example.com/integrations/quickbooks/disconnected');
        expect(urls.webhookUrl).toBe('https://dev.example.com/webhooks/quickbooks');
        // The three are different paths on purpose.
        expect(new Set([urls.redirectUri, urls.disconnectUrl, urls.webhookUrl]).size).toBe(3);
    });
});

/**
 * The constants name paths that are mounted elsewhere as string literals
 * (`server/index.ts`, `app/routes.ts`). A path that moved without its
 * constant would show operators an address that 404s, so the pairing is
 * asserted against the sources that actually mount them.
 */
describe('registration paths agree with where they are mounted', () => {
    it('the webhook endpoint is the path the API mounts', () => {
        expect(read('server/index.ts')).toContain(`.route('${QBO_WEBHOOK_PATH}'`);
    });

    it('the disconnect page is a route in the app route table', () => {
        expect(read('app/routes.ts')).toContain(QBO_DISCONNECT_PAGE_PATH.slice(1));
    });

    it('the callback path is under the OAuth mount the API uses', () => {
        expect(QBO_CALLBACK_PATH.startsWith('/api/integrations/qbo/')).toBe(true);
    });
});
