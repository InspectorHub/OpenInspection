/**
 * Portal #98 item 3 — the chrome must be able to say the window is open
 * WITHOUT anyone attempting a send.
 *
 * The server decides open-vs-closed and ships only the unlock instant, so the
 * banner has no clock arithmetic of its own to get wrong.
 */
import { describe, it, expect } from 'vitest';
import { resolveCoolingWindowForSession } from '../../../server/api/session-context';
import { COOLING_WINDOW_MS } from '../../../server/lib/email/outbound-cooling-window';

const NOW = 1_800_000_000_000;

describe('resolveCoolingWindowForSession', () => {
    it('reports the unlock instant while the window is open', () => {
        const createdAt = new Date(NOW - 60 * 60 * 1000);
        expect(resolveCoolingWindowForSession({ mode: 'saas', createdAt, nowMs: NOW }))
            .toEqual({ unlockAtMs: createdAt.getTime() + COOLING_WINDOW_MS });
    });

    it('reports nothing once the window has elapsed', () => {
        expect(resolveCoolingWindowForSession({
            mode: 'saas', createdAt: new Date(NOW - COOLING_WINDOW_MS - 1), nowMs: NOW,
        })).toBeNull();
    });

    it('reports nothing on a self-hosted deployment, however new the company is', () => {
        expect(resolveCoolingWindowForSession({
            mode: 'standalone', createdAt: new Date(NOW), nowMs: NOW,
        })).toBeNull();
    });

    it('reports nothing when the anchor is unreadable — the banner must not appear on a blip', () => {
        expect(resolveCoolingWindowForSession({ mode: 'saas', createdAt: null, nowMs: NOW })).toBeNull();
    });
});
