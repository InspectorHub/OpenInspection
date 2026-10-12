/**
 * The worker entry copies the browser's one-time Turnstile cookie onto the
 * in-process API call as a header. Only a mutation carries it, and only a
 * well-formed value does.
 */
import { describe, it, expect } from 'vitest';
import { humanTokenFromCookie, withHumanToken, HUMAN_TOKEN_HEADER } from '../../../workers/human-token';

const TOKEN = '0.AbCdEfGhIjKlMnOpQrStUvWx-_yz';
const cookie = `a=1; oi-human-token=${TOKEN}; b=2`;
const post = () => new Request('https://x.test/api/inspections/1/send', { method: 'POST', body: '{}' });

describe('humanTokenFromCookie', () => {
    it('reads the token out of a cookie header', () => {
        expect(humanTokenFromCookie(cookie)).toBe(TOKEN);
    });
    it('returns null when absent, empty or malformed', () => {
        expect(humanTokenFromCookie(undefined)).toBeNull();
        expect(humanTokenFromCookie('a=1')).toBeNull();
        expect(humanTokenFromCookie('oi-human-token=short')).toBeNull();
        expect(humanTokenFromCookie('oi-human-token=has space and <script>')).toBeNull();
    });
});

describe('withHumanToken', () => {
    it('adds the header to a mutation', () => {
        expect(withHumanToken(post(), cookie).headers.get(HUMAN_TOKEN_HEADER)).toBe(TOKEN);
    });
    it('leaves a GET untouched, so a render never spends the token', () => {
        const get = new Request('https://x.test/api/session/context');
        expect(withHumanToken(get, cookie)).toBe(get);
    });
    it('leaves a mutation untouched when there is no cookie', () => {
        const r = post();
        expect(withHumanToken(r, undefined)).toBe(r);
    });
    it('never overrides a header the caller already set', () => {
        const r = new Request('https://x.test/api/x', { method: 'POST', body: '{}', headers: { [HUMAN_TOKEN_HEADER]: 'from-caller-123' } });
        expect(withHumanToken(r, cookie).headers.get(HUMAN_TOKEN_HEADER)).toBe('from-caller-123');
    });
});
