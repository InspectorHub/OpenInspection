// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The editor action mints an API client via createApi and reads the token via
// requireToken. Both are mocked so the test exercises only the action's own
// branching — which endpoints it calls, in what order, for a given intent.
const completePost = vi.fn();
const publishPost = vi.fn();
const inspectionPatch = vi.fn();
/** Call order across endpoints — the whole point of the auto-sign specs. */
const calls: string[] = [];

vi.mock('~/lib/session.server', () => ({
    requireToken: vi.fn().mockResolvedValue('tok'),
}));
vi.mock('~/lib/api-client.server', () => ({
    createApi: vi.fn(() => ({
        inspections: {
            ':id': {
                complete: { $post: completePost },
                publish: { $post: publishPost },
                $patch: inspectionPatch,
            },
        },
    })),
}));

import { action } from './action.server';
import { routeArgs } from '../../../tests/helpers/route-args';
/** Minimal AppLoadContext stub — the action only forwards it to createApi. */
const CONTEXT = {} as Parameters<typeof action>[0]['context'];

function post(fields: Record<string, string>) {
    const body = new URLSearchParams(fields);
    const request = new Request('https://acme.example.com/inspections/insp-1/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    return action(routeArgs(request, { params: { id: 'insp-1' }, context: CONTEXT }));
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


/**
 * Auto-sign must be WRITTEN BEFORE the publish it was ticked for.
 *
 * The publish handler decides whether to sign by re-reading the inspection
 * row. The checkbox used to fire its own fetcher alongside the publish
 * request, so the two raced; when the toggle lost, publish read the old value
 * and the report went out UNSIGNED — while the flag still landed, so the NEXT
 * publish signed and the reader concluded they had mis-clicked. Verified
 * against a real local publish before this was written: first publish left
 * `_inspector_signature` absent, second one injected it.
 */
describe('editor action — auto-sign on publish', () => {
    beforeEach(() => {
        calls.length = 0;
        completePost.mockReset().mockImplementation(async () => { calls.push('complete'); return new Response(null, { status: 200 }); });
        publishPost.mockReset().mockImplementation(async () => { calls.push('publish'); return new Response(null, { status: 200 }); });
        inspectionPatch.mockReset().mockImplementation(async () => { calls.push('patch'); return new Response(null, { status: 200 }); });
    });

    it('writes the flag BEFORE publishing', async () => {
        await post({ intent: 'publish', autoSignOnPublish: 'true' });
        expect(inspectionPatch).toHaveBeenCalledWith({
            param: { id: 'insp-1' },
            json: { autoSignOnPublish: true },
        });
        // Order is the assertion. Both being called proves nothing on its own —
        // that was true of the racing version too.
        expect(calls).toEqual(['patch', 'publish']);
    });

    it('carries an explicit false, so unticking takes effect on this publish', async () => {
        // `false` must be written, not omitted: a previously-persisted `true`
        // would otherwise sign a report the reader had just opted out of.
        await post({ intent: 'publish', autoSignOnPublish: 'false' });
        expect(inspectionPatch).toHaveBeenCalledWith({
            param: { id: 'insp-1' },
            json: { autoSignOnPublish: false },
        });
        expect(calls).toEqual(['patch', 'publish']);
    });

    it('still orders complete -> flag -> publish when marking complete too', async () => {
        await post({ intent: 'publish', markComplete: 'true', autoSignOnPublish: 'true' });
        expect(calls).toEqual(['complete', 'patch', 'publish']);
    });

    it('touches nothing when the field is absent — a caller that never asked', async () => {
        await post({ intent: 'publish' });
        expect(inspectionPatch).not.toHaveBeenCalled();
        expect(calls).toEqual(['publish']);
    });
});
