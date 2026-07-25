// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The editor action mints an API client via createApi and reads the token via
// requireToken. Both are mocked so the test exercises only the action's own
// branching — which endpoints it calls, in what order, for a given intent.
const completePost = vi.fn();
const publishPost = vi.fn();

vi.mock('~/lib/session.server', () => ({
    requireToken: vi.fn().mockResolvedValue('tok'),
}));
vi.mock('~/lib/api-client.server', () => ({
    createApi: vi.fn(() => ({
        inspections: {
            ':id': {
                complete: { $post: completePost },
                publish: { $post: publishPost },
            },
        },
    })),
}));

import { action } from './action.server';

function post(fields: Record<string, string>) {
    const body = new URLSearchParams(fields);
    const request = new Request('https://acme.example.com/inspections/insp-1/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return action({ request, params: { id: 'insp-1' }, context: {} as any });
}

describe('editor action — order-lifecycle intents (IA-30 Task 4)', () => {
    beforeEach(() => {
        completePost.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
        publishPost.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    });

    it('intent=complete hits the complete endpoint only', async () => {
        const res = await post({ intent: 'complete' });
        expect(completePost).toHaveBeenCalledTimes(1);
        expect(completePost).toHaveBeenCalledWith({ param: { id: 'insp-1' } });
        expect(publishPost).not.toHaveBeenCalled();
        expect(res).toMatchObject({ ok: true, intent: 'complete' });
    });

    it('intent=publish without markComplete publishes and never marks complete', async () => {
        const res = await post({ intent: 'publish' });
        expect(publishPost).toHaveBeenCalledTimes(1);
        expect(completePost).not.toHaveBeenCalled();
        expect(res).toMatchObject({ ok: true, intent: 'publish' });
    });

    it('intent=publish with markComplete fires complete first, then publishes', async () => {
        const order: string[] = [];
        completePost.mockImplementation(() => { order.push('complete'); return Promise.resolve(new Response(null, { status: 200 })); });
        publishPost.mockImplementation(() => { order.push('publish'); return Promise.resolve(new Response(null, { status: 200 })); });

        const res = await post({ intent: 'publish', markComplete: 'true' });
        expect(order).toEqual(['complete', 'publish']);
        expect(res).toMatchObject({ ok: true, intent: 'publish' });
    });

    it('a failing complete never blocks the publish it precedes (advisory)', async () => {
        completePost.mockRejectedValue(new Error('complete boom'));
        const res = await post({ intent: 'publish', markComplete: 'true' });
        expect(publishPost).toHaveBeenCalledTimes(1);
        expect(res).toMatchObject({ ok: true, intent: 'publish' });
    });
});
