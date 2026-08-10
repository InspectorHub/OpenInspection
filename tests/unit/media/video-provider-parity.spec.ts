import { describe, it, expect } from 'vitest';
import { videoStreamServiceable, type ResolvedVideoProvider } from '../../../server/services/video/resolve';

function res(over: Partial<ResolvedVideoProvider>): ResolvedVideoProvider {
    return { provider: 'r2', streamSubdomain: null, streamBindingPresent: false, ...over };
}

describe('videoStreamServiceable — the agreement session-context claimed in prose', () => {
    it('is true only when stream is asked for AND both prerequisites are present', () => {
        expect(videoStreamServiceable(res({
            provider: 'stream', streamSubdomain: 'customer-abc', streamBindingPresent: true,
        }))).toBe(true);
    });

    it('is false when the subdomain is missing — the API 503s here, so the UI must not offer stream', () => {
        expect(videoStreamServiceable(res({
            provider: 'stream', streamSubdomain: null, streamBindingPresent: true,
        }))).toBe(false);
        expect(videoStreamServiceable(res({
            provider: 'stream', streamSubdomain: '', streamBindingPresent: true,
        }))).toBe(false);
    });

    it('is false when the STREAM binding is absent', () => {
        expect(videoStreamServiceable(res({
            provider: 'stream', streamSubdomain: 'customer-abc', streamBindingPresent: false,
        }))).toBe(false);
    });

    it('is false whenever r2 is the configured provider', () => {
        expect(videoStreamServiceable(res({
            provider: 'r2', streamSubdomain: 'customer-abc', streamBindingPresent: true,
        }))).toBe(false);
    });
});
