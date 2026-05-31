import { describe, it, expect } from 'vitest';
import { SeatBanner } from '../../server/features/seat-quota/seat-banner';

async function renderHtml(node: ReturnType<typeof SeatBanner>): Promise<string> {
    const resolved = await node;
    if (resolved === null || resolved === undefined) return '';
    return String(resolved);
}

describe('SeatBanner', () => {
    it('renders nothing when remaining > 1 (no nag)', async () => {
        const html = await renderHtml(SeatBanner({
            usage: { used: 3, max: 10, remaining: 7 },
            billingPortalUrl: 'https://billing.example.com',
        }));
        expect(html).toBe('');
    });

    it('renders a soft warning when remaining == 1', async () => {
        const html = await renderHtml(SeatBanner({
            usage: { used: 9, max: 10, remaining: 1 },
            billingPortalUrl: 'https://billing.example.com',
        }));
        expect(html).toContain('1 seat');
        expect(html).toContain('billing.example.com');
    });

    it('renders a hard-block message when remaining == 0', async () => {
        const html = await renderHtml(SeatBanner({
            usage: { used: 10, max: 10, remaining: 0 },
            billingPortalUrl: 'https://billing.example.com',
        }));
        expect(html).toContain('limit reached');
        expect(html).toContain('Upgrade');
    });

    it('renders nothing when max is null (unlimited)', async () => {
        const html = await renderHtml(SeatBanner({
            usage: { used: 50, max: null, remaining: Number.POSITIVE_INFINITY },
            billingPortalUrl: null,
        }));
        expect(html).toBe('');
    });
});
