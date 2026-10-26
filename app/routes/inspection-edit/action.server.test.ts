// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The editor action mints an API client via createApi and reads the token via
// requireToken. Both are mocked so the test exercises only the action's own
// branching — which endpoints it calls, in what order, for a given intent.
const completePost = vi.fn();
const publishPost = vi.fn();
const inspectionPatch = vi.fn();
const unitsPost = vi.fn();
const snapshotPatch = vi.fn();
const collabRestructure = vi.fn();
const templateGet = vi.fn();
const templatePut = vi.fn();
const signoffPost = vi.fn();
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
                units: { $post: unitsPost },
                'template-snapshot': { $patch: snapshotPatch },
                collab: { restructure: { $post: collabRestructure } },
                compliance: { signoff: { $post: signoffPost } },
            },
            templates: { ':id': { $get: templateGet, $put: templatePut } },
        },
    })),
}));

import { action } from './action.server';
import { createApi } from '~/lib/api-client.server';
import { routeArgs } from '../../../tests/helpers/route-args';
import { templatesRouteConfigs } from '../../../server/api/inspections/templates';
import { SignoffBodySchema } from '../../../server/lib/validations/compliance.schema';
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

/**
 * The revision reason has to LEAVE the action.
 *
 * `summary` is the per-publish revision reason: max 500 chars, stored on the new
 * `report_versions` row, and surfaced both as the reason in the report's
 * amendment trail and as the "what changed" line of the amendment email. This
 * action used to publish with an empty body no matter what, so every revision
 * ever published from the editor recorded `null` — measured on a real inspection
 * as two versions both carrying `summary: null`.
 */
describe('editor action — the revision reason travels with the publish', () => {
    beforeEach(() => {
        completePost.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
        publishPost.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
        inspectionPatch.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    });

    it('forwards a typed reason in the publish body', async () => {
        await post({ intent: 'publish', summary: 'Corrected the roof rating.' });
        expect(publishPost).toHaveBeenCalledWith({
            param: { id: 'insp-1' },
            json: { summary: 'Corrected the roof rating.' },
        });
    });

    it('sends NO summary key when the field is absent', async () => {
        // The discriminating half. An always-present `summary: ''` would write an
        // empty reason over the endpoint's NULL default, and the amendment trail
        // renders a present-but-empty reason as one somebody wrote.
        await post({ intent: 'publish' });
        expect(publishPost).toHaveBeenCalledWith({ param: { id: 'insp-1' }, json: {} });
    });

    it('sends no summary key for a whitespace-only reason', async () => {
        await post({ intent: 'publish', summary: '   ' });
        expect(publishPost).toHaveBeenCalledWith({ param: { id: 'insp-1' }, json: {} });
    });

    it('trims the reason it does send', async () => {
        await post({ intent: 'publish', summary: '  Reworded the summary.  ' });
        expect(publishPost).toHaveBeenCalledWith({
            param: { id: 'insp-1' },
            json: { summary: 'Reworded the summary.' },
        });
    });

    it('still orders the auto-sign write before the publish that carries a reason', async () => {
        calls.length = 0;
        completePost.mockImplementation(async () => { calls.push('complete'); return new Response(null, { status: 200 }); });
        publishPost.mockImplementation(async () => { calls.push('publish'); return new Response(null, { status: 200 }); });
        inspectionPatch.mockImplementation(async () => { calls.push('patch'); return new Response(null, { status: 200 }); });

        await post({ intent: 'publish', autoSignOnPublish: 'true', summary: 'Fixed a typo.' });
        expect(calls).toEqual(['patch', 'publish']);
        expect(publishPost).toHaveBeenCalledWith({
            param: { id: 'insp-1' },
            json: { summary: 'Fixed a typo.' },
        });
    });
});

// React Router decodes `%2F` in a route param, and the typed API client pastes params into the path
// without encoding them, so `..%2F..%2Fx%3F` would otherwise steer the forwarded call to another path.
// The guard sits right after the token check: nothing is read, nothing is forwarded.
describe('editor action: the inspection id must be a single path segment', () => {
    const bad = ['..', '.', '', '../x', 'a/b', 'a?b', 'a#b', `a${String.fromCharCode(92)}b`, 'a%2Fb', '%2e%2e'];

    function postWithId(id: string) {
        const request = new Request('https://acme.example.com/resources/inspection-editor-command/x', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ intent: 'complete' }).toString(),
        });
        return action(routeArgs(request, { params: { id }, context: CONTEXT }));
    }

    beforeEach(() => {
        completePost.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
        vi.mocked(createApi).mockClear();
    });

    it.each(bad)('refuses %j with a 400 and forwards nothing', async (id) => {
        const res = await postWithId(id);
        expect(res).toBeInstanceOf(Response);
        expect((res as Response).status).toBe(400);
        expect(createApi).not.toHaveBeenCalled();
        expect(completePost).not.toHaveBeenCalled();
    });

    it('CONTROL - an ordinary id still goes through', async () => {
        const res = await postWithId('3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f');
        expect(completePost).toHaveBeenCalledTimes(1);
        expect(res).toMatchObject({ ok: true, intent: 'complete' });
    });
});


/**
 * The web transport sends the command's idempotency key as a form field. A timed-out create is retried with
 * the same key, so the action must hand it to the API client for the intents that would otherwise duplicate.
 */
describe('editor action - idempotency key for non-idempotent intents', () => {
    beforeEach(() => {
        vi.mocked(createApi).mockClear();
        unitsPost.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
        completePost.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    });

    it('unit-create passes the key to the API client', async () => {
        await post({ intent: 'unit-create', name: 'Unit 4', idempotencyKey: 'key-123' });
        expect(vi.mocked(createApi).mock.calls[0]?.[1]).toMatchObject({ idempotencyKey: 'key-123' });
    });

    it('unit-create without a key passes none', async () => {
        await post({ intent: 'unit-create', name: 'Unit 4' });
        expect(vi.mocked(createApi).mock.calls[0]?.[1]?.idempotencyKey).toBeUndefined();
    });

    it('an idempotent intent never forwards the key', async () => {
        await post({ intent: 'complete', idempotencyKey: 'key-123' });
        expect(vi.mocked(createApi).mock.calls[0]?.[1]?.idempotencyKey).toBeUndefined();
    });
});

describe('editor action — who may receive a thrown "still running" answer', () => {
    function postTo(url: string) {
        const request = new Request(url, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ intent: 'unit-create', name: 'A', idempotencyKey: 'k-1' }).toString(),
        });
        return action(routeArgs(request, { params: { id: 'insp-1' }, context: CONTEXT }));
    }
    beforeEach(() => {
        unitsPost.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
        vi.mocked(createApi).mockClear();
    });

    it('the resource route (the command channel) asks for it', async () => {
        await postTo('https://acme.example.com/resources/inspection-editor-command/insp-1');
        expect(vi.mocked(createApi).mock.calls[0]?.[1]).toMatchObject({ idempotencyKey: 'k-1', inFlightAsResponse: true });
    });

    it('the page route does not: a thrown Response there would render the error boundary', async () => {
        await postTo('https://acme.example.com/inspections/insp-1/edit');
        expect(vi.mocked(createApi).mock.calls[0]?.[1]).toMatchObject({ idempotencyKey: 'k-1', inFlightAsResponse: false });
    });
});

const refusal = (status: number, message: string) => new Response(JSON.stringify({ error: { code: 'X', message } }), { status });

/**
 * A refused or thrown write must not be reported as done.
 *
 * The signing-preference PATCH used to be fire-and-forget, so a refusal still published (with the
 * stale flag), and the restructure PATCH result was dropped, so the editor showed a structure that
 * was never stored while the live document was told to converge on it.
 */
describe('editor action: publish honours a failed signing-preference write', () => {
    beforeEach(() => {
        calls.length = 0;
        completePost.mockReset().mockImplementation(async () => { calls.push('complete'); return new Response(null, { status: 200 }); });
        publishPost.mockReset().mockImplementation(async () => { calls.push('publish'); return new Response(null, { status: 200 }); });
        inspectionPatch.mockReset().mockImplementation(async () => { calls.push('patch'); return new Response(null, { status: 200 }); });
    });

    for (const status of [403, 500]) {
        it(`does not publish when the preference PATCH answers ${status}, and passes the server message on`, async () => {
            inspectionPatch.mockResolvedValue(refusal(status, 'Not allowed to change signing'));
            const res = await post({ intent: 'publish', markComplete: 'true', autoSignOnPublish: 'true' });
            expect(res).toEqual({ ok: false, intent: 'publish', error: 'Not allowed to change signing' });
            expect(publishPost).not.toHaveBeenCalled();
            // markComplete ran first and is advisory: it stays in effect.
            expect(calls).toEqual(['complete']);
        });
    }

    it('falls back to a fixed message when the refusal has no readable body', async () => {
        inspectionPatch.mockResolvedValue(new Response('<html>', { status: 502 }));
        const res = await post({ intent: 'publish', autoSignOnPublish: 'true' }) as { ok: boolean; error: string };
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/signing preference/i);
        expect(publishPost).not.toHaveBeenCalled();
    });

    it('does not publish when the preference PATCH throws', async () => {
        inspectionPatch.mockRejectedValue(new Error('socket closed'));
        const res = await post({ intent: 'publish', autoSignOnPublish: 'false' });
        expect(res).toMatchObject({ ok: false, intent: 'publish' });
        expect(publishPost).not.toHaveBeenCalled();
    });

    it('positive control: an accepted PATCH still publishes, in the same order', async () => {
        const res = await post({ intent: 'publish', autoSignOnPublish: 'true' });
        expect(res).toEqual({ ok: true, intent: 'publish' });
        expect(calls).toEqual(['patch', 'publish']);
    });

    it('positive control: a refused publish still carries the server message', async () => {
        publishPost.mockResolvedValue(refusal(409, 'Inspection must be completed before publishing the report.'));
        const res = await post({ intent: 'publish' });
        expect(res).toEqual({ ok: false, intent: 'publish', error: 'Inspection must be completed before publishing the report.' });
    });
});

describe('editor action: restructure honours the snapshot write', () => {
    const snapshot = JSON.stringify({ schemaVersion: 2, sections: [] });
    beforeEach(() => {
        calls.length = 0;
        snapshotPatch.mockReset().mockImplementation(async () => { calls.push('snapshot'); return new Response(null, { status: 200 }); });
        collabRestructure.mockReset().mockImplementation(async () => { calls.push('collab'); return new Response(null, { status: 200 }); });
    });

    for (const status of [400, 403, 500]) {
        it(`reports the failure and skips the live sync when the PATCH answers ${status}`, async () => {
            snapshotPatch.mockResolvedValue(refusal(status, 'Statutory forms cannot be restructured'));
            const res = await post({ intent: 'restructure', snapshot, collab: '1' });
            expect(res).toEqual({ ok: false, intent: 'restructure', error: 'Statutory forms cannot be restructured' });
            expect(collabRestructure).not.toHaveBeenCalled();
        });
    }

    it('reports a thrown PATCH as a failure and skips the live sync', async () => {
        snapshotPatch.mockRejectedValue(new Error('socket closed'));
        const res = await post({ intent: 'restructure', snapshot, collab: '1' });
        expect(res).toMatchObject({ ok: false, intent: 'restructure' });
        expect(collabRestructure).not.toHaveBeenCalled();
    });

    it('rejects an unparseable snapshot field without throwing and without writing', async () => {
        const res = await post({ intent: 'restructure', snapshot: '{not json', collab: '1' });
        expect(res).toMatchObject({ ok: false, intent: 'restructure' });
        expect(snapshotPatch).not.toHaveBeenCalled();
        expect(collabRestructure).not.toHaveBeenCalled();
    });

    it('positive control: PATCH ok then collab ok succeeds, in order', async () => {
        const res = await post({ intent: 'restructure', snapshot, collab: '1' });
        expect(res).toEqual({ ok: true, intent: 'restructure' });
        expect(calls).toEqual(['snapshot', 'collab']);
        expect(snapshotPatch).toHaveBeenCalledWith({ param: { id: 'insp-1' }, json: { snapshot: JSON.parse(snapshot) } });
    });

    it('positive control: without the collab flag only the snapshot is written', async () => {
        const res = await post({ intent: 'restructure', snapshot });
        expect(res).toEqual({ ok: true, intent: 'restructure' });
        expect(calls).toEqual(['snapshot']);
    });

    it('keeps the "live sync did not converge" message when the PATCH landed but collab refuses', async () => {
        collabRestructure.mockResolvedValue(new Response(null, { status: 403 }));
        const res = await post({ intent: 'restructure', snapshot, collab: '1' });
        expect(res).toMatchObject({ ok: false, intent: 'restructure', error: expect.stringContaining('live sync did not converge') });
    });

    it('keeps tolerating 501 from collab', async () => {
        collabRestructure.mockResolvedValue(new Response(null, { status: 501 }));
        const res = await post({ intent: 'restructure', snapshot, collab: '1' });
        expect(res).toEqual({ ok: true, intent: 'restructure' });
    });
});


/**
 * "Save back to the source template" needs the source template's NAME for the PUT. The server answers
 * GET /api/inspections/templates/:id with the template NESTED under `data.template`; the action used to
 * read `data.name`, so it always reported "The source template has no name." The fixtures below are built
 * by parsing a payload with the route's own response schema, so a reader that drifts from the real shape
 * fails here instead of in the browser.
 */
describe('editor action — save-structure-template back to the source', () => {
    const getRoute = templatesRouteConfigs.find((r) => r.operationId === 'getInspectionTemplate')!;
    const responseSchema = getRoute.responses[200].content['application/json'].schema;
    const realResponse = (template: Record<string, unknown>) =>
        new Response(JSON.stringify(responseSchema.parse({ success: true, data: { template } })), { status: 200 });
    const SNAPSHOT = JSON.stringify({ schemaVersion: 2, sections: [] });
    const back = (templateId = 'tpl-1') => post({ intent: 'save-structure-template', mode: 'back', templateId, snapshot: SNAPSHOT });

    beforeEach(() => {
        templateGet.mockReset();
        templatePut.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    });

    it('reads the name from data.template and PUTs it back with the new structure', async () => {
        templateGet.mockResolvedValue(realResponse({ id: 'tpl-1', name: '  Full Home Inspection ', version: 3, schema: { schemaVersion: 2, sections: [] } }));
        const res = await back();
        expect(templateGet).toHaveBeenCalledWith({ param: { id: 'tpl-1' } });
        expect(templatePut).toHaveBeenCalledWith({ param: { id: 'tpl-1' }, json: { name: 'Full Home Inspection', schema: { schemaVersion: 2, sections: [] } } });
        expect(res).toMatchObject({ ok: true, intent: 'save-structure-template' });
    });

    it('a template with a blank name fails the save without a PUT', async () => {
        templateGet.mockResolvedValue(realResponse({ id: 'tpl-1', name: '   ', version: 1 }));
        const res = await back();
        expect(templatePut).not.toHaveBeenCalled();
        expect(res).toMatchObject({ ok: false, error: 'The source template has no name.' });
    });

    it('a response with no template fails the save without a PUT', async () => {
        templateGet.mockResolvedValue(realResponse({}));
        const res = await back();
        expect(templatePut).not.toHaveBeenCalled();
        expect(res).toMatchObject({ ok: false, error: 'The source template has no name.' });
    });

    it('a 200 without a data envelope fails the save with the same message instead of throwing', async () => {
        templateGet.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
        const res = await back();
        expect(templatePut).not.toHaveBeenCalled();
        expect(res).toMatchObject({ ok: false, error: 'The source template has no name.' });
    });

    it('a failed load fails the save without a PUT', async () => {
        templateGet.mockResolvedValue(new Response(null, { status: 404 }));
        const res = await back();
        expect(templatePut).not.toHaveBeenCalled();
        expect(res).toMatchObject({ ok: false, error: 'Could not load the source template to update it.' });
    });
});

describe('editor action - compliance sign-off names a person only when one is typed', () => {
    beforeEach(() => { signoffPost.mockReset().mockResolvedValue(new Response(null, { status: 200 })); });

    it('sends only the role, license and dual-role flag, in a body the route accepts, and reports success', async () => {
        // No personId or name field in the form: the server records the signed-in user.
        const res = await post({ intent: 'compliance-signoff', role: 'pcr_reviewer', license: ' PE-1 ', dualRole: 'true' });
        expect(res).toMatchObject({ ok: true, intent: 'compliance-signoff', role: 'pcr_reviewer' });
        expect(signoffPost).toHaveBeenCalledTimes(1);
        const json = signoffPost.mock.calls[0]?.[0].json;
        expect(json).toEqual({ role: 'pcr_reviewer', license: 'PE-1', dualRole: true });
        expect(SignoffBodySchema.safeParse(json).success).toBe(true);
    });

    it('control: a person typed by an owner or manager is relayed as typed', async () => {
        const res = await post({ intent: 'compliance-signoff', role: 'pcr_reviewer', personId: ' ext-1 ', name: ' Eli Engineer ' });
        expect(res).toMatchObject({ ok: true });
        const json = signoffPost.mock.calls[0]?.[0].json;
        expect(json).toMatchObject({ personId: 'ext-1', name: 'Eli Engineer' });
        expect(SignoffBodySchema.safeParse(json).success).toBe(true);
    });

    it('a refused sign-off carries the server message back, so the panel can show it', async () => {
        signoffPost.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Name both or neither.' } }), { status: 400 }));
        const res = await post({ intent: 'compliance-signoff', role: 'pcr_reviewer', personId: 'ext-1' });
        expect(res).toMatchObject({ ok: false, intent: 'compliance-signoff', role: 'pcr_reviewer', error: 'Name both or neither.' });
    });

    it('control: a refusal with no readable body carries a generic message, and success carries none', async () => {
        signoffPost.mockResolvedValue(new Response(null, { status: 500 }));
        const refused = await post({ intent: 'compliance-signoff', role: 'pcr_reviewer' });
        expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/sign-off/i) });
        signoffPost.mockResolvedValue(new Response(null, { status: 200 }));
        expect(await post({ intent: 'compliance-signoff', role: 'pcr_reviewer' })).not.toHaveProperty('error');
    });

    it('control: a role that is not a sign-off role is refused without calling the route', async () => {
        const res = await post({ intent: 'compliance-signoff', role: 'owner' });
        expect(res).toMatchObject({ ok: false, intent: 'compliance-signoff' });
        expect(signoffPost).not.toHaveBeenCalled();
    });
});
