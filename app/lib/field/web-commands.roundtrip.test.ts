// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult, FieldCommand } from "@core/field-ui/commands";

// The REAL editor action runs against a mocked API client; only the endpoints
// each case needs are present. The encoder's FormData goes through a real
// Request, so multipart parsing and `instanceof File` behave as in production.
const completePost = vi.fn();
const publishPost = vi.fn();
const inspectionPatch = vi.fn();
const bulkPost = vi.fn();
const followupPost = vi.fn();
const psqStatusPost = vi.fn();
const instancesPost = vi.fn();
const uploadPost = vi.fn();

vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({
        inspections: {
            ":id": {
                complete: { $post: completePost },
                publish: { $post: publishPost },
                $patch: inspectionPatch,
                units: { bulk: { $post: bulkPost } },
                collab: { followup: { $post: followupPost } },
                compliance: { psq: { status: { $post: psqStatusPost } } },
                "statutory-form": { instances: { $post: instancesPost } },
                media: { upload: { $post: uploadPost } },
            },
        },
    })),
}));

import { action } from "../../routes/inspection-edit/action.server";
import { routeArgs } from "../../../tests/helpers/route-args";
import { decodeResult, encodeCommand } from "./web-commands";
import { SAMPLES } from "./web-commands.fixtures";

const CONTEXT = {} as Parameters<typeof action>[0]["context"];
const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });

/** Encode, run the real action, serialise like the resource route does, decode. */
async function roundTrip<C extends FieldCommand>(cmd: C): Promise<CommandResult<unknown>> {
    const { form } = encodeCommand(cmd);
    const request = new Request("https://acme.example.com/resources/inspection-editor-command/insp-1", { method: "POST", body: form });
    const answer = await action(routeArgs(request, { params: { id: "insp-1" }, context: CONTEXT }));
    const res = Response.json(answer);
    return decodeResult(cmd, res.status, await res.json(), { redirected: res.redirected, contentType: res.headers.get("content-type") });
}

describe("encoder agrees with the real editor action", () => {
    beforeEach(() => {
        for (const fn of [completePost, publishPost, inspectionPatch, bulkPost, followupPost, psqStatusPost, instancesPost, uploadPost]) {
            fn.mockReset().mockResolvedValue(ok());
        }
    });

    it("publish with markComplete completes first, patches auto-sign, then publishes", async () => {
        const order: string[] = [];
        completePost.mockImplementation(async () => { order.push("complete"); return ok(); });
        inspectionPatch.mockImplementation(async () => { order.push("patch"); return ok(); });
        publishPost.mockImplementation(async () => { order.push("publish"); return ok(); });
        const r = await roundTrip(SAMPLES.publish);
        expect(r).toEqual({ ok: true });
        expect(order).toEqual(["complete", "patch", "publish"]);
        expect(inspectionPatch).toHaveBeenCalledWith({ param: { id: "insp-1" }, json: { autoSignOnPublish: false } });
        expect(publishPost).toHaveBeenCalledWith({ param: { id: "insp-1" }, json: { summary: "Rev 2" } });
    });

    it("publish without optional fields does not touch the stored flag", async () => {
        expect(await roundTrip({ type: "publish" })).toEqual({ ok: true });
        expect(completePost).not.toHaveBeenCalled();
        expect(inspectionPatch).not.toHaveBeenCalled();
        expect(publishPost).toHaveBeenCalledWith({ param: { id: "insp-1" }, json: {} });
    });

    it("publish failure carries the server sentence", async () => {
        publishPost.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Must be completed" } }), { status: 409 }));
        expect(await roundTrip(SAMPLES.publish)).toEqual({ ok: false, error: "Must be completed" });
    });

    it("unit:bulk-create relays the whole payload", async () => {
        expect(await roundTrip(SAMPLES["unit:bulk-create"])).toEqual({ ok: true });
        expect(bulkPost).toHaveBeenCalledWith({ param: { id: "insp-1" }, json: { mode: "floors_stacks", floors: [1, 2], stacks: 2 } });
    });

    it("set-followup sends null for a cleared status and the note when given", async () => {
        expect(await roundTrip(SAMPLES["set-followup"])).toEqual({ ok: true });
        expect(followupPost).toHaveBeenCalledWith({ param: { id: "insp-1" }, json: { itemId: "i1", status: null, notes: "n" } });
        followupPost.mockClear();
        await roundTrip({ type: "set-followup", itemId: "i1", status: "ok" });
        expect(followupPost).toHaveBeenCalledWith({ param: { id: "insp-1" }, json: { itemId: "i1", status: "ok" } });
    });

    it("compliance:psq-status answers its status as data", async () => {
        expect(await roundTrip(SAMPLES["compliance:psq-status"])).toEqual({ ok: true, data: { status: "declined" } });
        expect(psqStatusPost).toHaveBeenCalledWith({ param: { id: "insp-1" }, json: { status: "declined", reason: "no time" } });
    });

    it("add-statutory-instance failure (an answer with no ok) decodes as ok:false", async () => {
        instancesPost.mockResolvedValue(new Response(JSON.stringify({ error: { message: "No such slot" } }), { status: 422 }));
        expect(await roundTrip(SAMPLES["add-statutory-instance"])).toEqual({ ok: false, error: "No such slot" });
        expect(instancesPost).toHaveBeenCalledWith({ param: { id: "insp-1" }, json: { groupId: "g1", index: 3, fields: { a: "b" } } });
    });

    it("autofill-property-facts BAD_ADDRESS needs no API call and returns data on failure", async () => {
        const r = await roundTrip({ type: "autofill-property-facts", addressString: "abc" });
        expect(r).toEqual({ ok: false, data: { facts: null, reason: "BAD_ADDRESS" } });
    });

    it("upload-cover reaches the action as a File and returns the key and url", async () => {
        uploadPost.mockResolvedValue(ok({ data: { key: "k9", url: "/p/k9" } }));
        const r = await roundTrip(SAMPLES["upload-cover"]);
        expect(r).toEqual({ ok: true, data: { coverKey: "k9", coverUrl: "/p/k9" } });
        expect(uploadPost.mock.calls[0]![0].form.file).toBeInstanceOf(File);
    });

    it("an unknown-intent control: a wrong field name makes the action refuse", async () => {
        const form = new FormData();
        form.append("intent", "unit-rename");
        form.append("unit", "u1");
        form.append("name", "B");
        const request = new Request("https://acme.example.com/x", { method: "POST", body: form });
        const answer = await action(routeArgs(request, { params: { id: "insp-1" }, context: CONTEXT }));
        expect(answer).toMatchObject({ ok: false });
    });
});
